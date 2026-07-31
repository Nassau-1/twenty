import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { createHash } from 'node:crypto';
import {
  FORMULA_SECURITY_LIMITS,
  type FormulaReferenceNode,
} from 'twenty-shared/formula';
import { Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

type FormulaDependency = FormulaReferenceNode['reference'];

type FormulaGraphNode = {
  definitionId: string | null;
  outputFieldMetadataId: string;
  dependencies: FormulaDependency[];
};

export type FormulaDependencyPlan = {
  candidateOutputFieldMetadataId: string;
  candidateDepth: number;
  directDependencyFieldMetadataIds: string[];
  directUpstreamFormulaDefinitionIds: string[];
  lineageKey: string;
  maxFormulaDepth: number;
  topologicalOutputFieldMetadataIds: string[];
  summary: string;
};

@Injectable()
export class FormulaDependencyPlannerService {
  constructor(
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
    @InjectWorkspaceScopedRepository(FormulaDefinitionEntity)
    private readonly formulaDefinitionRepository: WorkspaceScopedRepository<FormulaDefinitionEntity>,
  ) {}

  async planProspectiveVersion({
    workspaceId,
    objectMetadataId,
    objectMetadataUniversalIdentifier,
    outputFieldMetadataId,
    dependencies,
  }: {
    workspaceId: string;
    objectMetadataId: string;
    objectMetadataUniversalIdentifier: string;
    outputFieldMetadataId: string;
    dependencies: FormulaDependency[];
  }): Promise<FormulaDependencyPlan> {
    const [fields, definitions] = await Promise.all([
      this.fieldMetadataRepository.find({
        where: { workspaceId, objectMetadataId },
      }),
      this.formulaDefinitionRepository.find(workspaceId, {
        where: { objectMetadataId },
        relations: { versions: true },
      }),
    ]);

    if (
      definitions.some(
        (definition) =>
          definition.outputFieldMetadataId === outputFieldMetadataId,
      )
    ) {
      throw new BadRequestException(
        'A Formula already owns the selected output field.',
      );
    }

    const fieldsByUniversalIdentifier = new Map(
      fields.map((field) => [field.universalIdentifier, field]),
    );
    const nodes = definitions.flatMap((definition): FormulaGraphNode[] => {
      const activeVersion = definition.versions.find(
        (version) => version.id === definition.activeVersionId,
      );

      return activeVersion === undefined
        ? []
        : [
            {
              definitionId: definition.id,
              outputFieldMetadataId: definition.outputFieldMetadataId,
              dependencies: activeVersion.dependencies,
            },
          ];
    });
    const candidateNode: FormulaGraphNode = {
      definitionId: null,
      outputFieldMetadataId,
      dependencies,
    };
    const allNodes = [...nodes, candidateNode];
    const nodeByOutputFieldMetadataId = new Map(
      allNodes.map((node) => [node.outputFieldMetadataId, node]),
    );
    const nodeByDefinitionId = new Map(
      nodes.flatMap((node) =>
        node.definitionId === null ? [] : [[node.definitionId, node] as const],
      ),
    );

    const dependencyFieldIdsByNode = new Map<string, string[]>();
    const upstreamNodeIdsByNode = new Map<string, string[]>();

    for (const node of allNodes) {
      const dependencyFieldIds = new Set<string>();
      const upstreamNodeIds = new Set<string>();

      for (const dependency of node.dependencies) {
        if (dependency.kind === 'RELATION') {
          const relationField = fieldsByUniversalIdentifier.get(
            dependency.relationFieldMetadataUniversalIdentifier,
          );

          if (relationField === undefined) {
            throw new BadRequestException(
              'A Formula relation dependency does not belong to the selected object.',
            );
          }

          dependencyFieldIds.add(relationField.id);
          continue;
        }

        if (dependency.kind === 'FIELD') {
          const field = fieldsByUniversalIdentifier.get(
            dependency.fieldMetadataUniversalIdentifier,
          );

          if (field === undefined) {
            throw new BadRequestException(
              'A Formula dependency does not belong to the selected object.',
            );
          }

          dependencyFieldIds.add(field.id);
          const upstreamNode = nodeByOutputFieldMetadataId.get(field.id);

          if (upstreamNode !== undefined) {
            upstreamNodeIds.add(upstreamNode.outputFieldMetadataId);
          }
          continue;
        }

        if (dependency.kind === 'FORMULA') {
          if (
            dependency.owner.scope !== 'OBJECT' ||
            dependency.owner.objectMetadataUniversalIdentifier !==
              objectMetadataUniversalIdentifier
          ) {
            throw new BadRequestException(
              'Object Formulas can reference only object-scoped Formulas on the same object.',
            );
          }

          const upstreamNode = nodeByDefinitionId.get(
            dependency.formulaDefinitionId,
          );

          if (upstreamNode === undefined) {
            throw new BadRequestException(
              'A Formula dependency could not be resolved.',
            );
          }

          dependencyFieldIds.add(upstreamNode.outputFieldMetadataId);
          upstreamNodeIds.add(upstreamNode.outputFieldMetadataId);
          continue;
        }

        throw new BadRequestException(
          'The current Formula planner supports field, relation, and Formula dependencies only.',
        );
      }

      dependencyFieldIdsByNode.set(
        node.outputFieldMetadataId,
        [...dependencyFieldIds].sort(),
      );
      upstreamNodeIdsByNode.set(
        node.outputFieldMetadataId,
        [...upstreamNodeIds].sort(),
      );
    }

    const orderedNodeIds: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visitPath: string[] = [];
    const depthByNodeId = new Map<string, number>();

    const visit = (nodeId: string): number => {
      const knownDepth = depthByNodeId.get(nodeId);

      if (knownDepth !== undefined) {
        return knownDepth;
      }
      if (visiting.has(nodeId)) {
        const cycleStart = visitPath.indexOf(nodeId);
        const cycle = [...visitPath.slice(cycleStart), nodeId];

        throw new BadRequestException({
          message: 'Formula dependency cycle detected.',
          cycleOutputFieldMetadataIds: cycle,
        });
      }

      visiting.add(nodeId);
      visitPath.push(nodeId);
      const upstreamNodeIds = upstreamNodeIdsByNode.get(nodeId) ?? [];
      const depth =
        1 +
        upstreamNodeIds.reduce(
          (maximumDepth, upstreamNodeId) =>
            Math.max(maximumDepth, visit(upstreamNodeId)),
          0,
        );

      visitPath.pop();
      visiting.delete(nodeId);
      depthByNodeId.set(nodeId, depth);
      if (!visited.has(nodeId)) {
        visited.add(nodeId);
        orderedNodeIds.push(nodeId);
      }
      return depth;
    };

    for (const nodeId of [...nodeByOutputFieldMetadataId.keys()].sort()) {
      visit(nodeId);
    }

    const candidateDepth = depthByNodeId.get(outputFieldMetadataId) ?? 1;
    const maxFormulaDepth = Math.max(...depthByNodeId.values());

    if (maxFormulaDepth > FORMULA_SECURITY_LIMITS.maxFormulaChainDepth) {
      throw new BadRequestException({
        message: `Formula chains cannot exceed ${FORMULA_SECURITY_LIMITS.maxFormulaChainDepth} levels.`,
        candidateDepth,
        maxFormulaDepth,
      });
    }

    const candidateClosure = new Set<string>();
    const collectCandidateClosure = (nodeId: string) => {
      if (candidateClosure.has(nodeId)) {
        return;
      }

      candidateClosure.add(nodeId);
      for (const upstreamNodeId of upstreamNodeIdsByNode.get(nodeId) ?? []) {
        collectCandidateClosure(upstreamNodeId);
      }
    };

    collectCandidateClosure(outputFieldMetadataId);

    const directDependencyFieldMetadataIds =
      dependencyFieldIdsByNode.get(outputFieldMetadataId) ?? [];
    const directUpstreamFormulaDefinitionIds = (
      upstreamNodeIdsByNode.get(outputFieldMetadataId) ?? []
    )
      .map(
        (upstreamOutputFieldMetadataId) =>
          nodeByOutputFieldMetadataId.get(upstreamOutputFieldMetadataId)
            ?.definitionId,
      )
      .filter(
        (definitionId): definitionId is string =>
          typeof definitionId === 'string',
      )
      .sort();
    const lineageDocument = JSON.stringify({
      candidateOutputFieldMetadataId: outputFieldMetadataId,
      nodes: allNodes
        .filter((node) => candidateClosure.has(node.outputFieldMetadataId))
        .map((node) => ({
          definitionId: node.definitionId,
          outputFieldMetadataId: node.outputFieldMetadataId,
          dependencyFieldMetadataIds:
            dependencyFieldIdsByNode.get(node.outputFieldMetadataId) ?? [],
          upstreamOutputFieldMetadataIds:
            upstreamNodeIdsByNode.get(node.outputFieldMetadataId) ?? [],
        }))
        .sort((left, right) =>
          left.outputFieldMetadataId.localeCompare(right.outputFieldMetadataId),
        ),
    });
    const lineageKey = createHash('sha256')
      .update(lineageDocument)
      .digest('hex');

    return {
      candidateOutputFieldMetadataId: outputFieldMetadataId,
      candidateDepth,
      directDependencyFieldMetadataIds,
      directUpstreamFormulaDefinitionIds,
      lineageKey,
      maxFormulaDepth,
      topologicalOutputFieldMetadataIds: orderedNodeIds.filter((nodeId) =>
        candidateClosure.has(nodeId),
      ),
      summary: `Formula depth ${candidateDepth}; ${directUpstreamFormulaDefinitionIds.length} direct upstream Formula${directUpstreamFormulaDefinitionIds.length === 1 ? '' : 's'}.`,
    };
  }
}
