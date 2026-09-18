import { Scope } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  MessageChannelSyncStage,
  MessageChannelSyncStatus,
} from 'twenty-shared/types';
import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { MessageChannelSyncStatusService } from 'src/modules/messaging/common/services/message-channel-sync-status.service';
import { InjectCacheStorage } from 'src/engine/core-modules/cache-storage/decorators/cache-storage.decorator';
import { CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { CacheStorageNamespace } from 'src/engine/core-modules/cache-storage/types/cache-storage-namespace.enum';

export type MessagingRelaunchFailedMessageChannelJobData = {
  workspaceId: string;
  messageChannelId: string;
};

@Processor({
  queueName: MessageQueue.messagingQueue,
  scope: Scope.REQUEST,
})
export class MessagingRelaunchFailedMessageChannelJob {
  constructor(
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(MessageChannelEntity)
    private readonly messageChannelRepository: Repository<MessageChannelEntity>,
    private readonly messageChannelSyncStatusService: MessageChannelSyncStatusService,
    @InjectCacheStorage(CacheStorageNamespace.ModuleMessaging)
    private readonly cacheStorage: CacheStorageService,
  ) {}

  @Process(MessagingRelaunchFailedMessageChannelJob.name)
  async handle(data: MessagingRelaunchFailedMessageChannelJobData) {
    const { workspaceId, messageChannelId } = data;

    const authContext = buildSystemAuthContext(workspaceId);

    await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const messageChannel = await this.messageChannelRepository.findOne({
          where: {
            id: messageChannelId,
            workspaceId,
          },
        });

        if (
          !messageChannel ||
          !messageChannel.isSyncEnabled ||
          messageChannel.syncStage !== MessageChannelSyncStage.FAILED ||
          messageChannel.syncStatus !== MessageChannelSyncStatus.FAILED_UNKNOWN
        ) {
          return;
        }

        const pendingMessages = await this.cacheStorage.getSetLength(
          `messages-to-import:${workspaceId}:${messageChannelId}`,
        );

        // Retrying the saved batch also repairs participants/folders when the
        // failed write left partial message associations behind.
        if (pendingMessages > 0) {
          await this.messageChannelRepository.update(
            {
              id: messageChannelId,
              workspaceId,
              isSyncEnabled: true,
              syncStage: MessageChannelSyncStage.FAILED,
              syncStatus: MessageChannelSyncStatus.FAILED_UNKNOWN,
            },
            {
              syncStage: MessageChannelSyncStage.MESSAGES_IMPORT_PENDING,
              syncStatus: MessageChannelSyncStatus.ONGOING,
              throttleFailureCount: 0,
              throttleRetryAfter: null,
              syncStageStartedAt: null,
            },
          );

          return;
        }

        // Folder cursors advance during listing, before message persistence. A
        // failed import must replay them, not report success on an empty delta.
        await this.messageChannelSyncStatusService.resetAndMarkAsMessagesListFetchPending(
          [messageChannelId],
          workspaceId,
        );

        await this.messageChannelRepository.update(
          {
            id: messageChannelId,
            workspaceId,
            syncStage: MessageChannelSyncStage.MESSAGE_LIST_FETCH_PENDING,
          },
          {
            syncStatus: MessageChannelSyncStatus.ONGOING,
          },
        );
      },
      authContext,
      { lite: true },
    );
  }
}
