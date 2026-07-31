import { BadRequestException } from '@nestjs/common';

import {
  compileFormulaEditorDocument,
  type FormulaEditorDocument,
} from 'twenty-shared/formula';
import { FieldMetadataType } from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaAuthorizationService } from 'src/engine/metadata-modules/formula/formula-authorization.service';
import { FormulaApplicationService } from 'src/engine/metadata-modules/formula/formula-application.service';
import { FormulaDependencyPlannerService } from 'src/engine/metadata-modules/formula/formula-dependency-planner.service';
import { FormulaHistoryService } from 'src/engine/metadata-modules/formula/formula-history.service';
import { FormulaMetadataService } from 'src/engine/metadata-modules/formula/formula-metadata.service';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

const document: FormulaEditorDocument = {
  version: 1,
  source: 'Revenue * 2',
  references: [
    {
      kind: 'FIELD',
      fieldMetadataUniversalIdentifier: 'revenue-field',
      label: 'Revenue',
      span: { start: 0, end: 7 },
    },
  ],
};

const objectMetadata = {
  id: 'object-id',
  workspaceId: 'workspace-id',
  nameSingular: 'company',
  universalIdentifier: 'object-uid',
} as ObjectMetadataEntity;
const revenueField = {
  id: 'revenue-id',
  workspaceId: 'workspace-id',
  objectMetadataId: 'object-id',
  universalIdentifier: 'revenue-field',
  name: 'revenue',
  type: FieldMetadataType.NUMBER,
  isNullable: false,
  isUIEditable: true,
} as FieldMetadataEntity;
const outputField = {
  id: 'output-id',
  workspaceId: 'workspace-id',
  objectMetadataId: 'object-id',
  universalIdentifier: 'output-field',
  name: 'formulaResult',
  type: FieldMetadataType.NUMBER,
  isNullable: true,
  isUIEditable: false,
} as FieldMetadataEntity;
const peopleRelationField = {
  id: 'people-relation-id',
  workspaceId: 'workspace-id',
  objectMetadataId: 'object-id',
  relationTargetObjectMetadataId: 'person-object-id',
  universalIdentifier: 'people-relation',
  name: 'people',
  type: FieldMetadataType.RELATION,
  isNullable: true,
  isUIEditable: true,
} as FieldMetadataEntity;

describe('FormulaApplicationService', () => {
  const fieldMetadataRepository = {
    find: jest.fn(),
  };
  const objectMetadataRepository = {
    findOne: jest.fn(),
  };
  const formulaMetadataService = {
    countDefinitions: jest.fn(),
    createDefinitionWithActiveVersion: jest.fn(),
    findById: jest.fn(),
  };
  const formulaDependencyPlannerService = {
    planProspectiveVersion: jest.fn(),
  };
  const formulaAuthorizationService = {
    assertCanReadDependencies: jest.fn(),
  };
  const recordRepository = {
    createQueryBuilder: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const relationCountQueryBuilder = {
    getRawOne: jest.fn(),
    leftJoin: jest.fn(),
    select: jest.fn(),
    where: jest.fn(),
  };
  const formulaHistoryService = {
    previousValue: jest.fn(),
    valueAt: jest.fn(),
    appendFormulaMaterialization: jest.fn(),
  };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((callback) => callback()),
    getRepository: jest.fn(),
  };
  const service = new FormulaApplicationService(
    fieldMetadataRepository as unknown as Repository<FieldMetadataEntity>,
    objectMetadataRepository as unknown as Repository<ObjectMetadataEntity>,
    formulaDependencyPlannerService as unknown as FormulaDependencyPlannerService,
    formulaAuthorizationService as unknown as FormulaAuthorizationService,
    formulaMetadataService as unknown as FormulaMetadataService,
    formulaHistoryService as unknown as FormulaHistoryService,
    globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    objectMetadataRepository.findOne.mockResolvedValue(objectMetadata);
    fieldMetadataRepository.find.mockResolvedValue([revenueField, outputField]);
    formulaMetadataService.countDefinitions.mockResolvedValue(0);
    relationCountQueryBuilder.leftJoin.mockReturnValue(
      relationCountQueryBuilder,
    );
    relationCountQueryBuilder.select.mockReturnValue(relationCountQueryBuilder);
    relationCountQueryBuilder.where.mockReturnValue(relationCountQueryBuilder);
    recordRepository.createQueryBuilder.mockReturnValue(
      relationCountQueryBuilder,
    );
    formulaDependencyPlannerService.planProspectiveVersion.mockResolvedValue({
      candidateOutputFieldMetadataId: 'output-id',
      candidateDepth: 1,
      directDependencyFieldMetadataIds: ['revenue-id'],
      directUpstreamFormulaDefinitionIds: [],
      lineageKey: 'lineage-key',
      maxFormulaDepth: 1,
      topologicalOutputFieldMetadataIds: ['output-id'],
      summary: 'Formula depth 1; 0 direct upstream Formulas.',
    });
    formulaHistoryService.appendFormulaMaterialization.mockResolvedValue({
      evaluationReceiptId: 'receipt-id',
      inserted: true,
    });
  });

  it('compiles and persists a numeric Formula against a read-only output', async () => {
    formulaMetadataService.createDefinitionWithActiveVersion.mockResolvedValue({
      id: 'definition-id',
    });

    await service.createFormula({
      workspaceId: 'workspace-id',
      objectMetadataId: 'object-id',
      outputFieldMetadataId: 'output-id',
      document,
      reason: 'first slice',
    });

    expect(
      formulaMetadataService.createDefinitionWithActiveVersion,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        outputFieldMetadataId: 'output-id',
        compiledFormula: expect.objectContaining({
          output: { type: 'NUMBER', nullable: false },
        }),
      }),
    );
    expect(
      formulaDependencyPlannerService.planProspectiveVersion,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      objectMetadataId: 'object-id',
      objectMetadataUniversalIdentifier: 'object-uid',
      outputFieldMetadataId: 'output-id',
      dependencies: [
        {
          kind: 'FIELD',
          fieldMetadataUniversalIdentifier: 'revenue-field',
        },
      ],
    });
    expect(
      formulaAuthorizationService.assertCanReadDependencies,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      objectMetadataId: 'object-id',
      dependencyFieldMetadataIds: ['revenue-id'],
      dependencyObjectMetadataIds: [],
    });
  });

  it('returns a prospective plan without persisting the Formula', async () => {
    await expect(
      service.planFormula({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        outputFieldMetadataId: 'output-id',
        document,
        reason: null,
      }),
    ).resolves.toMatchObject({
      candidateDepth: 1,
      lineageKey: 'lineage-key',
    });
    expect(
      formulaMetadataService.createDefinitionWithActiveVersion,
    ).not.toHaveBeenCalled();
  });

  it('plans a relation count only when the target object is readable', async () => {
    const relationDocument: FormulaEditorDocument = {
      version: 1,
      source: 'count(People)',
      references: [
        {
          kind: 'RELATION',
          relationFieldMetadataUniversalIdentifier: 'people-relation',
          label: 'People',
          span: { start: 6, end: 12 },
        },
      ],
    };

    fieldMetadataRepository.find.mockResolvedValue([
      revenueField,
      peopleRelationField,
      outputField,
    ]);
    formulaDependencyPlannerService.planProspectiveVersion.mockResolvedValue({
      candidateOutputFieldMetadataId: 'output-id',
      candidateDepth: 1,
      directDependencyFieldMetadataIds: ['people-relation-id'],
      directUpstreamFormulaDefinitionIds: [],
      lineageKey: 'relation-lineage-key',
      maxFormulaDepth: 1,
      topologicalOutputFieldMetadataIds: ['output-id'],
      summary: 'Formula depth 1; 0 direct upstream Formulas.',
    });
    formulaMetadataService.createDefinitionWithActiveVersion.mockResolvedValue({
      id: 'relation-definition-id',
    });

    await service.createFormula({
      workspaceId: 'workspace-id',
      objectMetadataId: 'object-id',
      outputFieldMetadataId: 'output-id',
      document: relationDocument,
      reason: 'bounded relation count',
    });

    expect(
      formulaAuthorizationService.assertCanReadDependencies,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      objectMetadataId: 'object-id',
      dependencyFieldMetadataIds: ['people-relation-id'],
      dependencyObjectMetadataIds: ['person-object-id'],
    });
  });

  it('rejects a writable output field', async () => {
    fieldMetadataRepository.find.mockResolvedValue([
      revenueField,
      { ...outputField, isUIEditable: true },
    ]);

    await expect(
      service.createFormula({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        outputFieldMetadataId: 'output-id',
        document,
        reason: null,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(
      formulaMetadataService.createDefinitionWithActiveVersion,
    ).not.toHaveBeenCalled();
  });

  it('evaluates the active version and materializes the result', async () => {
    const compileResult = compileFormulaEditorDocument({
      document,
      resolveReference: () => ({
        status: 'success',
        type: 'NUMBER',
        nullable: false,
      }),
    });

    if (compileResult.status !== 'success') {
      throw new Error('Expected Formula compilation to succeed.');
    }

    formulaMetadataService.findById.mockResolvedValue({
      id: 'definition-id',
      workspaceId: 'workspace-id',
      objectMetadataId: 'object-id',
      outputFieldMetadataId: 'output-id',
      activeVersionId: 'version-id',
      versions: [
        {
          id: 'version-id',
          ast: compileResult.compiledFormula.ast,
          dependencies: compileResult.compiledFormula.dependencies,
          outputType: 'NUMBER',
          isNullable: false,
        },
      ],
    } as FormulaDefinitionEntity);
    recordRepository.findOne.mockResolvedValue({
      id: 'record-id',
      revenue: 125,
      formulaResult: null,
      updatedAt: '2026-07-30T12:00:00.000Z',
    });
    globalWorkspaceOrmManager.getRepository.mockResolvedValue(recordRepository);

    await expect(
      service.recomputeRecord({
        workspaceId: 'workspace-id',
        formulaDefinitionId: 'definition-id',
        recordId: 'record-id',
      }),
    ).resolves.toMatchObject({
      formulaDefinitionId: 'definition-id',
      formulaVersionId: 'version-id',
      recordId: 'record-id',
      outputFieldName: 'formulaResult',
      value: 250,
      evaluatorVersion: '1.2.0',
      instructionCount: 3,
    });
    expect(recordRepository.update).toHaveBeenCalledWith('record-id', {
      formulaResult: 250,
    });
    expect(
      formulaHistoryService.appendFormulaMaterialization,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        formulaDefinitionId: 'definition-id',
        formulaVersionId: 'version-id',
        beforeValue: null,
        afterValue: 250,
      }),
    );
  });

  it('materializes a previousValue Formula from authoritative history', async () => {
    const historicalDocument: FormulaEditorDocument = {
      version: 1,
      source: 'previousValue(Revenue) * 2',
      references: [
        {
          kind: 'FIELD',
          fieldMetadataUniversalIdentifier: 'revenue-field',
          label: 'Revenue',
          span: { start: 14, end: 21 },
        },
      ],
    };
    const compileResult = compileFormulaEditorDocument({
      document: historicalDocument,
      resolveReference: () => ({
        status: 'success',
        type: 'NUMBER',
        nullable: false,
      }),
    });

    if (compileResult.status !== 'success') {
      throw new Error('Expected historical Formula compilation to succeed.');
    }

    formulaMetadataService.findById.mockResolvedValue({
      id: 'definition-id',
      workspaceId: 'workspace-id',
      objectMetadataId: 'object-id',
      outputFieldMetadataId: 'output-id',
      activeVersionId: 'version-id',
      versions: [
        {
          id: 'version-id',
          ast: compileResult.compiledFormula.ast,
          dependencies: compileResult.compiledFormula.dependencies,
          outputType: 'NUMBER',
          isNullable: true,
        },
      ],
    } as FormulaDefinitionEntity);
    recordRepository.findOne.mockResolvedValue({
      id: 'record-id',
      revenue: 125,
      formulaResult: null,
      updatedAt: '2026-07-30T12:00:00.000Z',
    });
    globalWorkspaceOrmManager.getRepository.mockResolvedValue(recordRepository);
    formulaHistoryService.previousValue.mockResolvedValue({
      status: 'available',
      value: { type: 'NUMBER', value: 100 },
      effectiveAt: new Date('2026-07-30T12:00:00.000Z'),
      sequence: '1',
    });

    await expect(
      service.recomputeRecord({
        workspaceId: 'workspace-id',
        formulaDefinitionId: 'definition-id',
        recordId: 'record-id',
      }),
    ).resolves.toMatchObject({
      value: 200,
      evaluatorVersion: '1.2.0',
      historyAppended: true,
    });
    expect(formulaHistoryService.previousValue).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      objectMetadataId: 'object-id',
      recordId: 'record-id',
      fieldMetadataId: 'revenue-id',
    });
    expect(recordRepository.update).toHaveBeenCalledWith('record-id', {
      formulaResult: 200,
    });
  });

  it('materializes a bounded one-hop relation count', async () => {
    const relationDocument: FormulaEditorDocument = {
      version: 1,
      source: 'count(People)',
      references: [
        {
          kind: 'RELATION',
          relationFieldMetadataUniversalIdentifier: 'people-relation',
          label: 'People',
          span: { start: 6, end: 12 },
        },
      ],
    };
    const compileResult = compileFormulaEditorDocument({
      document: relationDocument,
      resolveReference: () => ({
        status: 'success',
        type: 'RELATION',
        nullable: false,
      }),
    });

    if (compileResult.status !== 'success') {
      throw new Error('Expected relation Formula compilation to succeed.');
    }

    fieldMetadataRepository.find.mockResolvedValue([
      revenueField,
      peopleRelationField,
      outputField,
    ]);
    formulaMetadataService.findById.mockResolvedValue({
      id: 'definition-id',
      workspaceId: 'workspace-id',
      objectMetadataId: 'object-id',
      outputFieldMetadataId: 'output-id',
      activeVersionId: 'version-id',
      versions: [
        {
          id: 'version-id',
          ast: compileResult.compiledFormula.ast,
          dependencies: compileResult.compiledFormula.dependencies,
          outputType: 'NUMBER',
          isNullable: false,
        },
      ],
    } as FormulaDefinitionEntity);
    recordRepository.findOne.mockResolvedValue({
      id: 'record-id',
      formulaResult: null,
      updatedAt: '2026-07-30T12:00:00.000Z',
    });
    relationCountQueryBuilder.getRawOne.mockResolvedValue({ count: '3' });
    globalWorkspaceOrmManager.getRepository.mockResolvedValue(recordRepository);

    await expect(
      service.recomputeRecord({
        workspaceId: 'workspace-id',
        formulaDefinitionId: 'definition-id',
        recordId: 'record-id',
      }),
    ).resolves.toMatchObject({
      value: 3,
      evaluatorVersion: '1.2.0',
      instructionCount: 2,
    });
    expect(relationCountQueryBuilder.leftJoin).toHaveBeenCalledWith(
      'formulaRecord.people',
      'formulaRelatedRecord',
    );
    expect(recordRepository.update).toHaveBeenCalledWith('record-id', {
      formulaResult: 3,
    });

    recordRepository.update.mockClear();
    relationCountQueryBuilder.getRawOne.mockResolvedValue({ count: '10001' });
    await expect(
      service.recomputeRecord({
        workspaceId: 'workspace-id',
        formulaDefinitionId: 'definition-id',
        recordId: 'record-id',
      }),
    ).rejects.toThrow('Formula relation count exceeds the 10000 record limit.');
    expect(recordRepository.update).not.toHaveBeenCalled();
  });
});
