import { Injectable } from '@nestjs/common';

import { createHash } from 'node:crypto';
import {
  type ObjectRecordCreateEvent,
  type ObjectRecordDeleteEvent,
  type ObjectRecordDestroyEvent,
  type ObjectRecordEvent,
  type ObjectRecordNonDestructiveEvent,
  type ObjectRecordRestoreEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
import { STANDARD_OBJECTS } from 'twenty-shared/metadata';

import { OnDatabaseBatchEvent } from 'src/engine/api/graphql/graphql-query-runner/decorators/on-database-batch-event.decorator';
import { DatabaseEventAction } from 'src/engine/api/graphql/graphql-query-runner/enums/database-event-action';
import { CreateEventLogFromInternalEvent } from 'src/engine/core-modules/event-logs/ingest/create-event-log-from-internal-event';
import { InjectMessageQueue } from 'src/engine/core-modules/message-queue/decorators/message-queue.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { CallWebhookJobsJob } from 'src/engine/metadata-modules/webhook/jobs/call-webhook-jobs.job';
import { WorkspaceEventBatchForWebhook } from 'src/engine/metadata-modules/webhook/types/workspace-event-batch-for-webhook.type';
import { CallDatabaseEventTriggerJobsJob } from 'src/engine/core-modules/logic-function/logic-function-trigger/triggers/database-event/call-database-event-trigger-jobs.job';
import { FormulaRecomputeJob } from 'src/engine/metadata-modules/formula/jobs/formula-recompute.job';
import { WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';
import { ObjectRecordEventPublisher } from 'src/engine/subscriptions/object-record-event/object-record-event-publisher';
import { UpsertTimelineActivityFromInternalEvent } from 'src/modules/timeline/jobs/upsert-timeline-activity-from-internal-event.job';

@Injectable()
export class EntityEventsToDbListener {
  constructor(
    @InjectMessageQueue(MessageQueue.entityEventsToDbQueue)
    private readonly entityEventsToDbQueueService: MessageQueueService,
    @InjectMessageQueue(MessageQueue.webhookQueue)
    private readonly webhookQueueService: MessageQueueService,
    @InjectMessageQueue(MessageQueue.triggerQueue)
    private readonly triggerQueueService: MessageQueueService,
    private readonly objectRecordEventPublisher: ObjectRecordEventPublisher,
  ) {}

  @OnDatabaseBatchEvent('*', DatabaseEventAction.CREATED)
  async handleCreate(batchEvent: WorkspaceEventBatch<ObjectRecordCreateEvent>) {
    return this.handleEvent(batchEvent, DatabaseEventAction.CREATED);
  }

  @OnDatabaseBatchEvent('*', DatabaseEventAction.UPDATED)
  async handleUpdate(batchEvent: WorkspaceEventBatch<ObjectRecordUpdateEvent>) {
    const eventIdentity = batchEvent.events
      .map((event) => ({
        recordId: event.recordId,
        updatedAt:
          (event.properties.after as Record<string, unknown>).updatedAt ?? null,
        updatedFields: [...event.properties.updatedFields].sort(),
      }))
      .sort((left, right) => left.recordId.localeCompare(right.recordId));
    const jobId = createHash('sha256')
      .update(
        JSON.stringify({
          workspaceId: batchEvent.workspaceId,
          objectMetadataId: batchEvent.objectMetadata.id,
          events: eventIdentity,
        }),
      )
      .digest('hex');

    await Promise.all([
      this.handleEvent(batchEvent, DatabaseEventAction.UPDATED),
      this.entityEventsToDbQueueService.add<
        WorkspaceEventBatch<ObjectRecordUpdateEvent>
      >(FormulaRecomputeJob.name, batchEvent, {
        id: `formula-recompute-${jobId}`,
        retryLimit: 3,
      }),
    ]);
  }

  @OnDatabaseBatchEvent('*', DatabaseEventAction.DELETED)
  async handleDelete(batchEvent: WorkspaceEventBatch<ObjectRecordDeleteEvent>) {
    return this.handleEvent(batchEvent, DatabaseEventAction.DELETED);
  }

  @OnDatabaseBatchEvent('*', DatabaseEventAction.RESTORED)
  async handleRestore(
    batchEvent: WorkspaceEventBatch<ObjectRecordRestoreEvent>,
  ) {
    return this.handleEvent(batchEvent, DatabaseEventAction.RESTORED);
  }

  @OnDatabaseBatchEvent('*', DatabaseEventAction.DESTROYED)
  async handleDestroy(
    batchEvent: WorkspaceEventBatch<ObjectRecordDestroyEvent>,
  ) {
    return this.handleEvent(batchEvent, DatabaseEventAction.DESTROYED);
  }

  private async handleEvent<T extends ObjectRecordEvent>(
    batchEvent: WorkspaceEventBatch<T>,
    action: DatabaseEventAction,
  ) {
    if (
      batchEvent.objectMetadata.universalIdentifier ===
      STANDARD_OBJECTS.timelineActivity.universalIdentifier
    ) {
      await this.objectRecordEventPublisher.publish(batchEvent);

      return;
    }

    const isAuditLogBatchEvent = batchEvent.objectMetadata?.isAuditLogged;

    const batchEventForWebhook = {
      ...batchEvent,
      objectMetadata: {
        id: batchEvent.objectMetadata.id,
        nameSingular: batchEvent.objectMetadata.nameSingular,
      },
    };

    const promises = [
      this.objectRecordEventPublisher.publish(batchEvent),
      this.webhookQueueService.add<WorkspaceEventBatchForWebhook<T>>(
        CallWebhookJobsJob.name,
        batchEventForWebhook,
        {
          retryLimit: 3,
        },
      ),
    ];

    promises.push(
      this.triggerQueueService.add<WorkspaceEventBatch<T>>(
        CallDatabaseEventTriggerJobsJob.name,
        batchEvent,
        { retryLimit: 3 },
      ),
    );

    if (isAuditLogBatchEvent && action !== DatabaseEventAction.DESTROYED) {
      promises.push(
        this.entityEventsToDbQueueService.add<WorkspaceEventBatch<T>>(
          CreateEventLogFromInternalEvent.name,
          batchEvent,
        ),
      );

      promises.push(
        this.entityEventsToDbQueueService.add<
          WorkspaceEventBatch<ObjectRecordNonDestructiveEvent>
        >(
          UpsertTimelineActivityFromInternalEvent.name,
          batchEvent as WorkspaceEventBatch<ObjectRecordNonDestructiveEvent>,
        ),
      );
    }

    await Promise.all(promises);
  }
}
