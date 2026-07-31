import { BadRequestException } from '@nestjs/common';

import { type FormulaReferenceNode } from 'twenty-shared/formula';
import { type Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaDependencyPlannerService } from 'src/engine/metadata-modules/formula/formula-dependency-planner.service';
import { type WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

type FormulaDependency = FormulaReferenceNode['reference'];

const fieldDependency = (
  fieldMetadataUniversalIdentifier: string,
): FormulaDependency => ({
  kind: 'FIELD',
  fieldMetadataUniversalIdentifier,
});
const relationDependency = (
  relationFieldMetadataUniversalIdentifier: string,
): FormulaDependency => ({
  kind: 'RELATION',
  relationFieldMetadataUniversalIdentifier,
});

const field = (id: string, universalIdentifier = `${id}-uid`) =>
  ({
    id,
    universalIdentifier,
    workspaceId: 'workspace-id',
    objectMetadataId: 'object-id',
  }) as FieldMetadataEntity;

const definition = ({
  id,
  outputFieldMetadataId,
  dependencies,
}: {
  id: string;
  outputFieldMetadataId: string;
  dependencies: FormulaDependency[];
}) =>
  ({
    id,
    workspaceId: 'workspace-id',
    objectMetadataId: 'object-id',
    outputFieldMetadataId,
    activeVersionId: `${id}-version`,
    versions: [
      {
        id: `${id}-version`,
        dependencies,
      },
    ],
  }) as FormulaDefinitionEntity;

describe('FormulaDependencyPlannerService', () => {
  const fieldMetadataRepository = {
    find: jest.fn(),
  };
  const formulaDefinitionRepository = {
    find: jest.fn(),
  };
  const service = new FormulaDependencyPlannerService(
    fieldMetadataRepository as unknown as Repository<FieldMetadataEntity>,
    formulaDefinitionRepository as unknown as WorkspaceScopedRepository<FormulaDefinitionEntity>,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns deterministic upstream-first topology for a three-level chain', async () => {
    fieldMetadataRepository.find.mockResolvedValue([
      field('source'),
      field('output-a'),
      field('output-b'),
      field('unrelated-output'),
      field('candidate-output'),
    ]);
    formulaDefinitionRepository.find.mockResolvedValue([
      definition({
        id: 'definition-b',
        outputFieldMetadataId: 'output-b',
        dependencies: [fieldDependency('output-a-uid')],
      }),
      definition({
        id: 'definition-a',
        outputFieldMetadataId: 'output-a',
        dependencies: [fieldDependency('source-uid')],
      }),
      definition({
        id: 'unrelated-definition',
        outputFieldMetadataId: 'unrelated-output',
        dependencies: [fieldDependency('source-uid')],
      }),
    ]);

    await expect(
      service.planProspectiveVersion({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        objectMetadataUniversalIdentifier: 'object-uid',
        outputFieldMetadataId: 'candidate-output',
        dependencies: [fieldDependency('output-b-uid')],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        candidateDepth: 3,
        directDependencyFieldMetadataIds: ['output-b'],
        directUpstreamFormulaDefinitionIds: ['definition-b'],
        maxFormulaDepth: 3,
        topologicalOutputFieldMetadataIds: [
          'output-a',
          'output-b',
          'candidate-output',
        ],
        lineageKey: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    );
  });

  it('rejects a prospective cycle with the output-field path', async () => {
    fieldMetadataRepository.find.mockResolvedValue([
      field('output-a'),
      field('candidate-output'),
    ]);
    formulaDefinitionRepository.find.mockResolvedValue([
      definition({
        id: 'definition-a',
        outputFieldMetadataId: 'output-a',
        dependencies: [fieldDependency('candidate-output-uid')],
      }),
    ]);

    await expect(
      service.planProspectiveVersion({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        objectMetadataUniversalIdentifier: 'object-uid',
        outputFieldMetadataId: 'candidate-output',
        dependencies: [fieldDependency('output-a-uid')],
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        message: 'Formula dependency cycle detected.',
        cycleOutputFieldMetadataIds: [
          'candidate-output',
          'output-a',
          'candidate-output',
        ],
      }),
    });
  });

  it('includes a one-hop relation in the bounded direct dependency plan', async () => {
    fieldMetadataRepository.find.mockResolvedValue([
      field('people-relation'),
      field('candidate-output'),
    ]);
    formulaDefinitionRepository.find.mockResolvedValue([]);

    await expect(
      service.planProspectiveVersion({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        objectMetadataUniversalIdentifier: 'object-uid',
        outputFieldMetadataId: 'candidate-output',
        dependencies: [relationDependency('people-relation-uid')],
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        candidateDepth: 1,
        directDependencyFieldMetadataIds: ['people-relation'],
        directUpstreamFormulaDefinitionIds: [],
        topologicalOutputFieldMetadataIds: ['candidate-output'],
      }),
    );
  });

  it('rejects chains deeper than the V1 three-level limit', async () => {
    fieldMetadataRepository.find.mockResolvedValue([
      field('source'),
      field('output-a'),
      field('output-b'),
      field('output-c'),
      field('candidate-output'),
    ]);
    formulaDefinitionRepository.find.mockResolvedValue([
      definition({
        id: 'definition-a',
        outputFieldMetadataId: 'output-a',
        dependencies: [fieldDependency('source-uid')],
      }),
      definition({
        id: 'definition-b',
        outputFieldMetadataId: 'output-b',
        dependencies: [fieldDependency('output-a-uid')],
      }),
      definition({
        id: 'definition-c',
        outputFieldMetadataId: 'output-c',
        dependencies: [fieldDependency('output-b-uid')],
      }),
    ]);

    await expect(
      service.planProspectiveVersion({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        objectMetadataUniversalIdentifier: 'object-uid',
        outputFieldMetadataId: 'candidate-output',
        dependencies: [fieldDependency('output-c-uid')],
      }),
    ).rejects.toMatchObject({
      response: {
        message: 'Formula chains cannot exceed 3 levels.',
        candidateDepth: 4,
        maxFormulaDepth: 4,
      },
    });
  });

  it('rejects list-local Formula references from an object Formula', async () => {
    fieldMetadataRepository.find.mockResolvedValue([
      field('output-a'),
      field('candidate-output'),
    ]);
    formulaDefinitionRepository.find.mockResolvedValue([
      definition({
        id: 'definition-a',
        outputFieldMetadataId: 'output-a',
        dependencies: [],
      }),
    ]);

    await expect(
      service.planProspectiveVersion({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        objectMetadataUniversalIdentifier: 'object-uid',
        outputFieldMetadataId: 'candidate-output',
        dependencies: [
          {
            kind: 'FORMULA',
            formulaDefinitionId: 'definition-a',
            owner: {
              scope: 'LIST_LOCAL',
              objectMetadataUniversalIdentifier: 'object-uid',
              viewUniversalIdentifier: 'view-uid',
              localColumnUniversalIdentifier: 'column-uid',
            },
          },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
