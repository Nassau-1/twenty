import { type Repository } from 'typeorm';

import {
  MessageChannelSyncStage,
  MessageChannelSyncStatus,
} from 'twenty-shared/types';
import { type MessageChannelEntity } from 'src/engine/metadata-modules/message-channel/entities/message-channel.entity';
import { type GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { type MessageChannelSyncStatusService } from 'src/modules/messaging/common/services/message-channel-sync-status.service';
import { type CacheStorageService } from 'src/engine/core-modules/cache-storage/services/cache-storage.service';
import { MessagingRelaunchFailedMessageChannelJob } from 'src/modules/messaging/message-import-manager/jobs/messaging-relaunch-failed-message-channel.job';

describe('MessagingRelaunchFailedMessageChannelJob', () => {
  const data = { workspaceId: 'workspace-id', messageChannelId: 'channel-id' };
  let repository: { findOne: jest.Mock; update: jest.Mock };
  let statusService: { resetAndMarkAsMessagesListFetchPending: jest.Mock };
  let cache: { getSetLength: jest.Mock };
  let job: MessagingRelaunchFailedMessageChannelJob;

  beforeEach(() => {
    repository = {
      findOne: jest.fn().mockResolvedValue({
        id: data.messageChannelId,
        isSyncEnabled: true,
        syncStage: MessageChannelSyncStage.FAILED,
        syncStatus: MessageChannelSyncStatus.FAILED_UNKNOWN,
        syncCursor: 'already-fetched-but-not-persisted',
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    statusService = {
      resetAndMarkAsMessagesListFetchPending: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    cache = { getSetLength: jest.fn().mockResolvedValue(0) };
    job = new MessagingRelaunchFailedMessageChannelJob(
      {
        executeInWorkspaceContext: (callback: () => Promise<void>) =>
          callback(),
      } as GlobalWorkspaceOrmManager,
      repository as unknown as Repository<MessageChannelEntity>,
      statusService as unknown as MessageChannelSyncStatusService,
      cache as unknown as CacheStorageService,
    );
  });

  it('resumes saved failed batches without clearing them or skipping partial writes', async () => {
    cache.getSetLength.mockResolvedValue(400);
    await job.handle(data);
    expect(cache.getSetLength).toHaveBeenCalledWith(
      'messages-to-import:workspace-id:channel-id',
    );
    expect(
      statusService.resetAndMarkAsMessagesListFetchPending,
    ).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith(
      {
        id: data.messageChannelId,
        workspaceId: data.workspaceId,
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
  });

  it('does not claim recovery when reading the retry set fails', async () => {
    cache.getSetLength.mockRejectedValue(new Error('cache unavailable'));
    await expect(job.handle(data)).rejects.toThrow('cache unavailable');
    expect(repository.update).not.toHaveBeenCalled();
    expect(
      statusService.resetAndMarkAsMessagesListFetchPending,
    ).not.toHaveBeenCalled();
  });

  it('replays channel and folder cursors rather than accepting an empty delta', async () => {
    await job.handle(data);

    expect(
      statusService.resetAndMarkAsMessagesListFetchPending,
    ).toHaveBeenCalledWith([data.messageChannelId], data.workspaceId);
    expect(repository.update).toHaveBeenCalledWith(
      {
        id: data.messageChannelId,
        workspaceId: data.workspaceId,
        isSyncEnabled: true,
        syncStage: MessageChannelSyncStage.FAILED,
        syncStatus: MessageChannelSyncStatus.FAILED_UNKNOWN,
      },
      { syncStatus: MessageChannelSyncStatus.ONGOING },
    );
    expect(
      statusService.resetAndMarkAsMessagesListFetchPending.mock
        .invocationCallOrder[0],
    ).toBeGreaterThan(repository.update.mock.invocationCallOrder[0]);
  });

  it.each([
    null,
    {
      isSyncEnabled: false,
      syncStage: MessageChannelSyncStage.FAILED,
      syncStatus: MessageChannelSyncStatus.FAILED_UNKNOWN,
    },
    {
      isSyncEnabled: true,
      syncStage: MessageChannelSyncStage.MESSAGES_IMPORT_ONGOING,
      syncStatus: MessageChannelSyncStatus.ONGOING,
    },
    {
      isSyncEnabled: true,
      syncStage: MessageChannelSyncStage.FAILED,
      syncStatus: MessageChannelSyncStatus.FAILED_INSUFFICIENT_PERMISSIONS,
    },
  ])('does not reset an ineligible channel: %p', async (channel) => {
    repository.findOne.mockResolvedValue(channel);
    await job.handle(data);
    expect(
      statusService.resetAndMarkAsMessagesListFetchPending,
    ).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('never marks success or schedules a delta when cursor reset fails', async () => {
    statusService.resetAndMarkAsMessagesListFetchPending.mockRejectedValue(
      new Error('reset failed'),
    );
    await expect(job.handle(data)).rejects.toThrow('reset failed');
    expect(repository.update).toHaveBeenLastCalledWith(
      {
        id: data.messageChannelId,
        workspaceId: data.workspaceId,
        syncStage: MessageChannelSyncStage.FAILED,
        syncStatus: MessageChannelSyncStatus.ONGOING,
      },
      { syncStatus: MessageChannelSyncStatus.FAILED_UNKNOWN },
    );
  });

  it('does not reset cursors after losing the conditional recovery claim', async () => {
    repository.update.mockResolvedValue({ affected: 0 });
    await job.handle(data);
    expect(
      statusService.resetAndMarkAsMessagesListFetchPending,
    ).not.toHaveBeenCalled();
  });
});
