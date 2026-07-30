import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';

import { DataSource, EntityManager } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaMetadataService } from 'src/engine/metadata-modules/formula/formula-metadata.service';
import { getWorkspaceScopedRepositoryToken } from 'src/engine/twenty-orm/workspace-scoped-repository/get-workspace-scoped-repository-token.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

describe('FormulaMetadataService', () => {
  const fieldRepository = {
    findOne: jest.fn(),
  };
  const definitionRepository = {
    count: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    withManager: jest.fn(),
  };
  const versionRepository = {
    create: jest.fn((value) => value),
    save: jest.fn(),
  };
  const entityManager = {
    getRepository: jest.fn(() => versionRepository),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn((callback) => callback(entityManager)),
  };
  const workspaceCacheService = {
    invalidateAndRecompute: jest.fn(),
  };
  let service: FormulaMetadataService;

  beforeEach(async () => {
    jest.clearAllMocks();
    definitionRepository.withManager.mockReturnValue(definitionRepository);
    const module = await Test.createTestingModule({
      providers: [
        FormulaMetadataService,
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(FieldMetadataEntity),
          useValue: fieldRepository,
        },
        {
          provide: getWorkspaceScopedRepositoryToken(FormulaDefinitionEntity),
          useValue: definitionRepository,
        },
        { provide: WorkspaceCacheService, useValue: workspaceCacheService },
      ],
    }).compile();
    service = module.get(FormulaMetadataService);
  });

  it('creates the immutable version and activates it in one transaction', async () => {
    fieldRepository.findOne.mockResolvedValue({ id: 'output-field' });
    definitionRepository.save
      .mockResolvedValueOnce({
        id: 'definition',
        activeVersionId: null,
      })
      .mockImplementationOnce(async (_workspaceId, definition) => definition);
    versionRepository.save.mockResolvedValue({ id: 'version' });

    const result = await service.createDefinitionWithActiveVersion({
      workspaceId: 'workspace',
      objectMetadataId: 'object',
      outputFieldMetadataId: 'output-field',
      editorDocument: {
        version: 1,
        source: '2',
        references: [],
      },
      compiledFormula: {
        ast: {
          version: 1,
          root: {
            kind: 'LITERAL',
            value: { type: 'DECIMAL', value: '2' },
            span: { start: 0, end: 1 },
          },
        },
        dependencies: [],
        output: { type: 'NUMBER', nullable: false },
      },
      createdByWorkspaceMemberId: null,
      reason: 'first slice',
    });

    expect(fieldRepository.findOne).toHaveBeenCalledWith({
      where: {
        id: 'output-field',
        objectMetadataId: 'object',
        workspaceId: 'workspace',
      },
    });
    expect(versionRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        definitionId: 'definition',
        outputType: 'NUMBER',
      }),
    );
    expect(result.activeVersionId).toBe('version');
    expect(workspaceCacheService.invalidateAndRecompute).toHaveBeenCalledWith(
      'workspace',
      ['rolesPermissions'],
    );
  });

  it('rejects an output field outside the requested workspace or object', async () => {
    fieldRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createDefinitionWithActiveVersion({
        workspaceId: 'workspace',
        objectMetadataId: 'object',
        outputFieldMetadataId: 'other-field',
        editorDocument: { version: 1, source: '2', references: [] },
        compiledFormula: {
          ast: {
            version: 1,
            root: {
              kind: 'LITERAL',
              value: { type: 'DECIMAL', value: '2' },
              span: { start: 0, end: 1 },
            },
          },
          dependencies: [],
          output: { type: 'NUMBER', nullable: false },
        },
        createdByWorkspaceMemberId: null,
        reason: null,
      }),
    ).rejects.toThrow(
      'Formula output field must belong to the requested workspace and object.',
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });
});
