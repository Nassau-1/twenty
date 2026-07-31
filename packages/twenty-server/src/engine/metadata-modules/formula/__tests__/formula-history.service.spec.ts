import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import { type Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaFieldHistoryEntity } from 'src/engine/metadata-modules/formula/entities/formula-field-history.entity';
import { FormulaHistoryService } from 'src/engine/metadata-modules/formula/formula-history.service';
import { type WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

describe('FormulaHistoryService', () => {
  const fieldMetadataRepository = {
    find: jest.fn(),
  };
  const execute = jest.fn();
  const queryBuilder = {
    insert: jest.fn(),
    values: jest.fn(),
    orIgnore: jest.fn(),
    execute,
  };
  const historyRepository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
  };
  const service = new FormulaHistoryService(
    fieldMetadataRepository as unknown as Repository<FieldMetadataEntity>,
    historyRepository as unknown as WorkspaceScopedRepository<FormulaFieldHistoryEntity>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    queryBuilder.insert.mockReturnValue(queryBuilder);
    queryBuilder.values.mockReturnValue(queryBuilder);
    queryBuilder.orIgnore.mockReturnValue(queryBuilder);
    historyRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    execute.mockResolvedValue({ identifiers: [{ id: 'history-id' }] });
    fieldMetadataRepository.find.mockResolvedValue([
      { id: 'source-id', name: 'source' },
      { id: 'output-id', name: 'result' },
    ]);
  });

  it('captures source updates and excludes Formula output fields', async () => {
    const batch = {
      name: 'company.updated',
      workspaceId: 'workspace-id',
      objectMetadata: { id: 'object-id' },
      events: [
        {
          recordId: 'record-id',
          workspaceMemberId: 'member-id',
          properties: {
            updatedFields: ['source', 'result'],
            before: {
              source: 10,
              result: 20,
              updatedAt: '2026-07-30T10:00:00.000Z',
            },
            after: {
              source: 12,
              result: 24,
              updatedAt: '2026-07-30T10:01:00.000Z',
            },
            diff: {},
          },
        },
      ],
    } as unknown as WorkspaceEventBatch<
      ObjectRecordUpdateEvent<Record<string, unknown>>
    >;

    await expect(
      service.captureFieldUpdates(
        batch,
        new Set(['source-id', 'output-id']),
        new Set(['output-id']),
      ),
    ).resolves.toBe(1);
    expect(queryBuilder.values).toHaveBeenCalledWith([
      expect.objectContaining({
        fieldMetadataId: 'source-id',
        beforeValue: 10,
        afterValue: 12,
        actorWorkspaceMemberId: 'member-id',
        effectiveAt: new Date('2026-07-30T10:01:00.000Z'),
      }),
    ]);
  });

  it('returns explicit unavailable coverage before the first event', async () => {
    historyRepository.findOne
      .mockResolvedValueOnce({
        effectiveAt: new Date('2026-07-30T10:00:00.000Z'),
      })
      .mockResolvedValueOnce(null);

    await expect(
      service.valueAt(
        {
          workspaceId: 'workspace-id',
          objectMetadataId: 'object-id',
          recordId: 'record-id',
          fieldMetadataId: 'source-id',
        },
        new Date('2026-07-29T10:00:00.000Z'),
      ),
    ).resolves.toEqual({
      status: 'unavailable',
      coverageStartedAt: new Date('2026-07-30T10:00:00.000Z'),
    });
  });

  it('returns the latest prior canonical value', async () => {
    historyRepository.findOne.mockResolvedValue({
      beforeValue: 12,
      effectiveAt: new Date('2026-07-30T10:01:00.000Z'),
      sequence: '42',
    });

    await expect(
      service.previousValue({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        recordId: 'record-id',
        fieldMetadataId: 'source-id',
      }),
    ).resolves.toEqual({
      status: 'available',
      value: { type: 'NUMBER', value: 12 },
      effectiveAt: new Date('2026-07-30T10:01:00.000Z'),
      sequence: '42',
    });
  });
});
