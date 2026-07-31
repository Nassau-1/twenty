import {
  type ObjectRecordCreateEvent,
  type ObjectRecordDeleteEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';

import { EntityEventsToDbListener } from 'src/engine/api/graphql/workspace-query-runner/listeners/entity-events-to-db.listener';
import { type MessageQueueService } from 'src/engine/core-modules/message-queue/services/message-queue.service';
import { FormulaRecomputeJob } from 'src/engine/metadata-modules/formula/jobs/formula-recompute.job';
import { type ObjectRecordEventPublisher } from 'src/engine/subscriptions/object-record-event/object-record-event-publisher';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

jest.mock(
  'src/engine/core-modules/event-logs/ingest/create-event-log-from-internal-event',
  () => ({ CreateEventLogFromInternalEvent: class {} }),
);
jest.mock(
  'src/engine/core-modules/logic-function/logic-function-trigger/triggers/database-event/call-database-event-trigger-jobs.job',
  () => ({ CallDatabaseEventTriggerJobsJob: class {} }),
);
jest.mock(
  'src/engine/metadata-modules/formula/jobs/formula-recompute.job',
  () => ({ FormulaRecomputeJob: class FormulaRecomputeJob {} }),
);
jest.mock(
  'src/engine/metadata-modules/webhook/jobs/call-webhook-jobs.job',
  () => ({ CallWebhookJobsJob: class {} }),
);
jest.mock(
  'src/modules/timeline/jobs/upsert-timeline-activity-from-internal-event.job',
  () => ({ UpsertTimelineActivityFromInternalEvent: class {} }),
);

describe('EntityEventsToDbListener Formula updates', () => {
  const entityEventsQueue = {
    add: jest.fn(),
  };
  const webhookQueue = {
    add: jest.fn(),
  };
  const triggerQueue = {
    add: jest.fn(),
  };
  const objectRecordEventPublisher = {
    publish: jest.fn(),
  };
  const listener = new EntityEventsToDbListener(
    entityEventsQueue as unknown as MessageQueueService,
    webhookQueue as unknown as MessageQueueService,
    triggerQueue as unknown as MessageQueueService,
    objectRecordEventPublisher as unknown as ObjectRecordEventPublisher,
  );
  const batch = {
    name: 'company.updated',
    workspaceId: 'workspace-id',
    objectMetadata: {
      id: 'object-id',
      nameSingular: 'company',
      universalIdentifier: 'company-uid',
      isAuditLogged: false,
    },
    events: [
      {
        recordId: 'record-id',
        properties: {
          updatedFields: ['formulaSource'],
          before: { updatedAt: '2026-07-30T20:00:00.000Z' },
          after: { updatedAt: '2026-07-30T20:01:00.000Z' },
          diff: {},
        },
      },
    ],
  } as unknown as WorkspaceEventBatch<ObjectRecordUpdateEvent>;

  beforeEach(() => {
    jest.clearAllMocks();
    entityEventsQueue.add.mockResolvedValue(undefined);
    webhookQueue.add.mockResolvedValue(undefined);
    triggerQueue.add.mockResolvedValue(undefined);
    objectRecordEventPublisher.publish.mockResolvedValue(undefined);
  });

  it('enqueues one durable retryable recompute job for an update batch', async () => {
    await listener.handleUpdate(batch);

    expect(entityEventsQueue.add).toHaveBeenCalledWith(
      FormulaRecomputeJob.name,
      batch,
      {
        id: expect.stringMatching(/^formula-recompute-[0-9a-f]{64}$/),
        retryLimit: 3,
      },
    );
  });

  it('enqueues relation recomputes for create and delete batches', async () => {
    const createBatch = {
      ...batch,
      name: 'person.created',
      events: [
        {
          recordId: 'person-id',
          properties: { after: { companyId: 'company-id' } },
        },
      ],
    } as unknown as WorkspaceEventBatch<ObjectRecordCreateEvent>;
    const deleteBatch = {
      ...batch,
      name: 'person.deleted',
      events: [
        {
          recordId: 'person-id',
          properties: {
            before: { companyId: 'company-id' },
            after: { companyId: 'company-id', deletedAt: new Date() },
            updatedFields: ['deletedAt'],
            diff: {},
          },
        },
      ],
    } as unknown as WorkspaceEventBatch<ObjectRecordDeleteEvent>;

    await listener.handleCreate(createBatch);
    await listener.handleDelete(deleteBatch);

    const formulaJobs = entityEventsQueue.add.mock.calls.filter(
      ([jobName]) => jobName === FormulaRecomputeJob.name,
    );

    expect(formulaJobs).toHaveLength(2);
    expect(formulaJobs[0]).toEqual([
      FormulaRecomputeJob.name,
      createBatch,
      {
        id: expect.stringMatching(/^formula-recompute-[0-9a-f]{64}$/),
        retryLimit: 3,
      },
    ]);
    expect(formulaJobs[1]).toEqual([
      FormulaRecomputeJob.name,
      deleteBatch,
      {
        id: expect.stringMatching(/^formula-recompute-[0-9a-f]{64}$/),
        retryLimit: 3,
      },
    ]);
  });
});
