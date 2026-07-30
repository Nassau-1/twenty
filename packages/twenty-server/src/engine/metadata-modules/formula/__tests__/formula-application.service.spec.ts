import { BadRequestException } from '@nestjs/common';

import {
  compileFormulaEditorDocument,
  type FormulaEditorDocument,
} from 'twenty-shared/formula';
import { FieldMetadataType } from 'twenty-shared/types';
import { type Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaApplicationService } from 'src/engine/metadata-modules/formula/formula-application.service';
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

describe('FormulaApplicationService', () => {
  const fieldMetadataRepository = {
    find: jest.fn(),
  };
  const objectMetadataRepository = {
    findOne: jest.fn(),
  };
  const formulaMetadataService = {
    createDefinitionWithActiveVersion: jest.fn(),
    findById: jest.fn(),
  };
  const recordRepository = {
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const globalWorkspaceOrmManager = {
    executeInWorkspaceContext: jest.fn((callback) => callback()),
    getRepository: jest.fn(),
  };
  const service = new FormulaApplicationService(
    fieldMetadataRepository as unknown as Repository<FieldMetadataEntity>,
    objectMetadataRepository as unknown as Repository<ObjectMetadataEntity>,
    formulaMetadataService as unknown as FormulaMetadataService,
    globalWorkspaceOrmManager as unknown as GlobalWorkspaceOrmManager,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    objectMetadataRepository.findOne.mockResolvedValue(objectMetadata);
    fieldMetadataRepository.find.mockResolvedValue([revenueField, outputField]);
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
    });
    expect(recordRepository.update).toHaveBeenCalledWith('record-id', {
      formulaResult: 250,
    });
  });
});
