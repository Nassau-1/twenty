import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import { type Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaApplicationService } from 'src/engine/metadata-modules/formula/formula-application.service';
import { FormulaHistoryService } from 'src/engine/metadata-modules/formula/formula-history.service';
import { FormulaReactiveService } from 'src/engine/metadata-modules/formula/formula-reactive.service';
import { type WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

describe('FormulaReactiveService', () => {
  const fieldMetadataRepository = {
    find: jest.fn(),
  };
  const formulaDefinitionRepository = {
    find: jest.fn(),
  };
  const formulaApplicationService = {
    recomputeRecord: jest.fn(),
  };
  const formulaHistoryService = {
    captureFieldUpdates: jest.fn(),
  };
  const service = new FormulaReactiveService(
    fieldMetadataRepository as unknown as Repository<FieldMetadataEntity>,
    formulaDefinitionRepository as unknown as WorkspaceScopedRepository<FormulaDefinitionEntity>,
    formulaApplicationService as unknown as FormulaApplicationService,
    formulaHistoryService as unknown as FormulaHistoryService,
  );
  const batch = {
    name: 'company.updated',
    workspaceId: 'workspace-id',
    objectMetadata: { id: 'object-id' },
    events: [
      {
        recordId: 'record-id',
        properties: {
          updatedFields: ['formulaSource', 'name'],
          before: {},
          after: {},
          diff: {},
        },
      },
    ],
  } as unknown as WorkspaceEventBatch<
    ObjectRecordUpdateEvent<Record<string, unknown>>
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    fieldMetadataRepository.find.mockResolvedValue([
      {
        id: 'source-field-id',
        name: 'formulaSource',
        universalIdentifier: 'source-field-uid',
      },
      {
        id: 'name-field-id',
        name: 'name',
        universalIdentifier: 'name-field-uid',
      },
    ]);
    formulaDefinitionRepository.find.mockResolvedValue([
      {
        id: 'formula-id',
        outputFieldMetadataId: 'formula-output-id',
        activeVersionId: 'version-id',
        versions: [
          {
            id: 'version-id',
            ast: {
              version: 1,
              root: {
                kind: 'CALL',
                functionName: 'previousValue',
                arguments: [
                  {
                    kind: 'REFERENCE',
                    reference: {
                      kind: 'FIELD',
                      fieldMetadataUniversalIdentifier: 'source-field-uid',
                    },
                    span: { start: 14, end: 21 },
                  },
                ],
                span: { start: 0, end: 22 },
              },
            },
            dependencies: [
              {
                kind: 'FIELD',
                fieldMetadataUniversalIdentifier: 'source-field-uid',
              },
            ],
          },
        ],
      },
      {
        id: 'unrelated-formula-id',
        outputFieldMetadataId: 'unrelated-output-id',
        activeVersionId: 'unrelated-version-id',
        versions: [
          {
            id: 'unrelated-version-id',
            ast: {
              version: 1,
              root: {
                kind: 'REFERENCE',
                reference: {
                  kind: 'FIELD',
                  fieldMetadataUniversalIdentifier: 'other-field-uid',
                },
                span: { start: 0, end: 5 },
              },
            },
            dependencies: [
              {
                kind: 'FIELD',
                fieldMetadataUniversalIdentifier: 'other-field-uid',
              },
            ],
          },
        ],
      },
    ]);
    formulaApplicationService.recomputeRecord.mockResolvedValue({});
    formulaHistoryService.captureFieldUpdates.mockResolvedValue(2);
  });

  it('recomputes each active Formula that depends on a changed field', async () => {
    await expect(service.recomputeFromUpdateBatch(batch)).resolves.toEqual({
      recomputedCount: 1,
    });
    expect(formulaApplicationService.recomputeRecord).toHaveBeenCalledTimes(1);
    expect(formulaApplicationService.recomputeRecord).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      formulaDefinitionId: 'formula-id',
      recordId: 'record-id',
    });
    expect(formulaHistoryService.captureFieldUpdates).toHaveBeenCalledWith(
      batch,
      new Set(['source-field-id']),
      new Set(['formula-output-id', 'unrelated-output-id']),
    );
  });

  it('does not recompute when the update touches no Formula dependency', async () => {
    const unrelatedBatch = {
      ...batch,
      events: [
        {
          ...batch.events[0],
          properties: {
            ...batch.events[0].properties,
            updatedFields: ['name'],
          },
        },
      ],
    };

    await expect(
      service.recomputeFromUpdateBatch(unrelatedBatch),
    ).resolves.toEqual({ recomputedCount: 0 });
    expect(formulaApplicationService.recomputeRecord).not.toHaveBeenCalled();
  });
});
