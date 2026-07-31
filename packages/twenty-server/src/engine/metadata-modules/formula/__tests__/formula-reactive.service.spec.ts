import {
  type ObjectRecordCreateEvent,
  type ObjectRecordDeleteEvent,
  type ObjectRecordUpdateEvent,
} from 'twenty-shared/database-events';
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
    recomputeRecordAsSystem: jest.fn(),
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
  const configureInverseRelation = () => {
    fieldMetadataRepository.find.mockResolvedValue([
      {
        id: 'company-field-id',
        name: 'company',
        objectMetadataId: 'person-object-id',
        universalIdentifier: 'company-relation-uid',
      },
      {
        id: 'people-relation-id',
        name: 'people',
        objectMetadataId: 'object-id',
        relationTargetFieldMetadataId: 'company-field-id',
        relationTargetObjectMetadataId: 'person-object-id',
        universalIdentifier: 'people-relation-uid',
      },
    ]);
    formulaDefinitionRepository.find.mockResolvedValue([
      {
        id: 'relation-formula-id',
        objectMetadataId: 'object-id',
        outputFieldMetadataId: 'relation-output-id',
        activeVersionId: 'relation-version-id',
        versions: [
          {
            id: 'relation-version-id',
            ast: {
              version: 1,
              root: {
                kind: 'CALL',
                functionName: 'count',
                arguments: [],
                span: { start: 0, end: 13 },
              },
            },
            dependencies: [
              {
                kind: 'RELATION',
                relationFieldMetadataUniversalIdentifier: 'people-relation-uid',
              },
            ],
          },
        ],
      },
    ]);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    fieldMetadataRepository.find.mockResolvedValue([
      {
        id: 'source-field-id',
        name: 'formulaSource',
        objectMetadataId: 'object-id',
        universalIdentifier: 'source-field-uid',
      },
      {
        id: 'name-field-id',
        name: 'name',
        objectMetadataId: 'object-id',
        universalIdentifier: 'name-field-uid',
      },
      {
        id: 'people-relation-id',
        name: 'people',
        objectMetadataId: 'object-id',
        universalIdentifier: 'people-relation-uid',
      },
    ]);
    formulaDefinitionRepository.find.mockResolvedValue([
      {
        id: 'formula-id',
        objectMetadataId: 'object-id',
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
        objectMetadataId: 'object-id',
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
      {
        id: 'relation-formula-id',
        objectMetadataId: 'object-id',
        outputFieldMetadataId: 'relation-output-id',
        activeVersionId: 'relation-version-id',
        versions: [
          {
            id: 'relation-version-id',
            ast: {
              version: 1,
              root: {
                kind: 'CALL',
                functionName: 'count',
                arguments: [
                  {
                    kind: 'REFERENCE',
                    reference: {
                      kind: 'RELATION',
                      relationFieldMetadataUniversalIdentifier:
                        'people-relation-uid',
                    },
                    span: { start: 6, end: 12 },
                  },
                ],
                span: { start: 0, end: 13 },
              },
            },
            dependencies: [
              {
                kind: 'RELATION',
                relationFieldMetadataUniversalIdentifier: 'people-relation-uid',
              },
            ],
          },
        ],
      },
    ]);
    formulaApplicationService.recomputeRecordAsSystem.mockResolvedValue({});
    formulaHistoryService.captureFieldUpdates.mockResolvedValue(2);
  });

  it('recomputes each active Formula that depends on a changed field', async () => {
    await expect(service.recomputeFromUpdateBatch(batch)).resolves.toEqual({
      recomputedCount: 1,
    });
    expect(
      formulaApplicationService.recomputeRecordAsSystem,
    ).toHaveBeenCalledTimes(1);
    expect(
      formulaApplicationService.recomputeRecordAsSystem,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      formulaDefinitionId: 'formula-id',
      recordId: 'record-id',
    });
    expect(formulaHistoryService.captureFieldUpdates).toHaveBeenCalledWith(
      batch,
      new Set(['source-field-id']),
      new Set([
        'formula-output-id',
        'unrelated-output-id',
        'relation-output-id',
      ]),
    );
  });

  it('recomputes a relation aggregate when its owner relation changes', async () => {
    const relationBatch = {
      ...batch,
      events: [
        {
          ...batch.events[0],
          properties: {
            ...batch.events[0].properties,
            updatedFields: ['people'],
          },
        },
      ],
    };

    await expect(
      service.recomputeFromUpdateBatch(relationBatch),
    ).resolves.toEqual({ recomputedCount: 1 });
    expect(
      formulaApplicationService.recomputeRecordAsSystem,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      formulaDefinitionId: 'relation-formula-id',
      recordId: 'record-id',
    });
  });

  it('recomputes both owners exactly once when an inverse relation moves', async () => {
    configureInverseRelation();
    const inverseBatch = {
      ...batch,
      objectMetadata: { id: 'person-object-id' },
      events: [
        {
          recordId: 'person-record-id',
          properties: {
            updatedFields: ['company', 'companyId'],
            before: { companyId: 'old-company-id' },
            after: { companyId: 'new-company-id' },
            diff: {
              company: {
                before: { id: 'old-company-id' },
                after: { id: 'new-company-id' },
              },
            },
          },
        },
      ],
    } as unknown as WorkspaceEventBatch<
      ObjectRecordUpdateEvent<Record<string, unknown>>
    >;

    await expect(
      service.recomputeFromUpdateBatch(inverseBatch),
    ).resolves.toEqual({ recomputedCount: 2 });
    expect(
      formulaApplicationService.recomputeRecordAsSystem.mock.calls,
    ).toEqual([
      [
        {
          workspaceId: 'workspace-id',
          formulaDefinitionId: 'relation-formula-id',
          recordId: 'new-company-id',
        },
      ],
      [
        {
          workspaceId: 'workspace-id',
          formulaDefinitionId: 'relation-formula-id',
          recordId: 'old-company-id',
        },
      ],
    ]);
  });

  it('recomputes relation owners when linked records are created or deleted', async () => {
    configureInverseRelation();
    const createBatch = {
      ...batch,
      name: 'person.created',
      objectMetadata: { id: 'person-object-id' },
      events: [
        {
          recordId: 'person-record-id',
          properties: {
            after: { companyId: 'company-id' },
          },
        },
      ],
    } as unknown as WorkspaceEventBatch<
      ObjectRecordCreateEvent<Record<string, unknown>>
    >;

    await expect(service.recomputeFromEventBatch(createBatch)).resolves.toEqual(
      {
        recomputedCount: 1,
      },
    );
    expect(
      formulaApplicationService.recomputeRecordAsSystem,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      formulaDefinitionId: 'relation-formula-id',
      recordId: 'company-id',
    });

    formulaApplicationService.recomputeRecordAsSystem.mockClear();
    const deleteBatch = {
      ...batch,
      name: 'person.deleted',
      objectMetadata: { id: 'person-object-id' },
      events: [
        {
          recordId: 'person-record-id',
          properties: {
            before: { company: { id: 'company-id' } },
            after: { company: { id: 'company-id' }, deletedAt: new Date() },
            updatedFields: ['deletedAt'],
            diff: {},
          },
        },
      ],
    } as unknown as WorkspaceEventBatch<
      ObjectRecordDeleteEvent<Record<string, unknown>>
    >;

    await expect(service.recomputeFromEventBatch(deleteBatch)).resolves.toEqual(
      {
        recomputedCount: 1,
      },
    );
    expect(
      formulaApplicationService.recomputeRecordAsSystem,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      formulaDefinitionId: 'relation-formula-id',
      recordId: 'company-id',
    });
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
    expect(
      formulaApplicationService.recomputeRecordAsSystem,
    ).not.toHaveBeenCalled();
  });
});
