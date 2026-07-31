import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import { type FormulaNode } from 'twenty-shared/formula';
import { type Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaApplicationService } from 'src/engine/metadata-modules/formula/formula-application.service';
import { FormulaHistoryService } from 'src/engine/metadata-modules/formula/formula-history.service';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

const collectHistoricalFieldUniversalIdentifiers = (
  root: FormulaNode,
): Set<string> => {
  const fieldUniversalIdentifiers = new Set<string>();
  const visit = (node: FormulaNode): void => {
    if (
      node.kind === 'CALL' &&
      (node.functionName === 'previousValue' || node.functionName === 'valueAt')
    ) {
      const source = node.arguments[0];

      if (source.kind === 'REFERENCE' && source.reference.kind === 'FIELD') {
        fieldUniversalIdentifiers.add(
          source.reference.fieldMetadataUniversalIdentifier,
        );
      }
    }

    switch (node.kind) {
      case 'BINARY':
        visit(node.left);
        visit(node.right);
        break;
      case 'CALL':
        node.arguments.forEach(visit);
        break;
      case 'UNARY':
        visit(node.operand);
        break;
      case 'LITERAL':
      case 'REFERENCE':
        break;
    }
  };

  visit(root);

  return fieldUniversalIdentifiers;
};

const collectRelatedRecordIds = (value: unknown): string[] => {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectRelatedRecordIds);
  }
  if (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string'
  ) {
    return [value.id];
  }

  return [];
};

@Injectable()
export class FormulaReactiveService {
  constructor(
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
    @InjectWorkspaceScopedRepository(FormulaDefinitionEntity)
    private readonly formulaDefinitionRepository: WorkspaceScopedRepository<FormulaDefinitionEntity>,
    private readonly formulaApplicationService: FormulaApplicationService,
    private readonly formulaHistoryService: FormulaHistoryService,
  ) {}

  async recomputeFromUpdateBatch(
    batch: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<Record<string, unknown>>
    >,
  ): Promise<{ recomputedCount: number }> {
    const [fields, definitions] = await Promise.all([
      this.fieldMetadataRepository.find({
        where: [
          {
            workspaceId: batch.workspaceId,
            objectMetadataId: batch.objectMetadata.id,
          },
          {
            workspaceId: batch.workspaceId,
            relationTargetObjectMetadataId: batch.objectMetadata.id,
          },
        ],
      }),
      this.formulaDefinitionRepository.find(batch.workspaceId, {
        relations: { versions: true },
      }),
    ]);
    const currentObjectFields = fields.filter(
      (field) => field.objectMetadataId === batch.objectMetadata.id,
    );
    const reverseRelationFields = fields.filter(
      (field) =>
        field.objectMetadataId !== batch.objectMetadata.id &&
        field.relationTargetObjectMetadataId === batch.objectMetadata.id,
    );
    const fieldUniversalIdentifierByName = new Map(
      currentObjectFields.map((field) => [
        field.name,
        field.universalIdentifier,
      ]),
    );
    const activeDefinitions = definitions
      .flatMap((definition) => {
        const activeVersion = definition.versions.find(
          (version) => version.id === definition.activeVersionId,
        );

        return activeVersion === undefined
          ? []
          : [{ definition, activeVersion }];
      })
      .sort((left, right) =>
        left.definition.id.localeCompare(right.definition.id),
      );
    const formulaOutputFieldMetadataIds = new Set(
      definitions
        .filter(
          (definition) =>
            definition.objectMetadataId === batch.objectMetadata.id,
        )
        .map((definition) => definition.outputFieldMetadataId),
    );
    const fieldMetadataIdByUniversalIdentifier = new Map(
      currentObjectFields.map((field) => [field.universalIdentifier, field.id]),
    );
    const trackedFieldMetadataIds = new Set(
      activeDefinitions
        .filter(
          ({ definition }) =>
            definition.objectMetadataId === batch.objectMetadata.id,
        )
        .flatMap(({ activeVersion }) => [
          ...collectHistoricalFieldUniversalIdentifiers(activeVersion.ast.root),
        ])
        .map((universalIdentifier) =>
          fieldMetadataIdByUniversalIdentifier.get(universalIdentifier),
        )
        .filter((fieldMetadataId): fieldMetadataId is string =>
          Boolean(fieldMetadataId),
        ),
    );

    await this.formulaHistoryService.captureFieldUpdates(
      batch,
      trackedFieldMetadataIds,
      formulaOutputFieldMetadataIds,
    );

    const recomputeTargets = new Map<
      string,
      { formulaDefinitionId: string; recordId: string }
    >();
    const addRecomputeTarget = (
      formulaDefinitionId: string,
      recordId: string,
    ) => {
      recomputeTargets.set(`${formulaDefinitionId}:${recordId}`, {
        formulaDefinitionId,
        recordId,
      });
    };

    for (const event of batch.events) {
      const changedFieldUniversalIdentifiers = new Set(
        event.properties.updatedFields
          .map((fieldName) => fieldUniversalIdentifierByName.get(fieldName))
          .filter(
            (universalIdentifier): universalIdentifier is string =>
              typeof universalIdentifier === 'string',
          ),
      );

      if (changedFieldUniversalIdentifiers.size === 0) {
        continue;
      }

      for (const { definition, activeVersion } of activeDefinitions) {
        if (definition.objectMetadataId !== batch.objectMetadata.id) {
          continue;
        }
        const dependsOnChangedField = activeVersion.dependencies.some(
          (dependency) => {
            const dependencyUniversalIdentifier =
              dependency.kind === 'FIELD'
                ? dependency.fieldMetadataUniversalIdentifier
                : dependency.kind === 'RELATION'
                  ? dependency.relationFieldMetadataUniversalIdentifier
                  : null;

            return (
              dependencyUniversalIdentifier !== null &&
              changedFieldUniversalIdentifiers.has(
                dependencyUniversalIdentifier,
              )
            );
          },
        );

        if (!dependsOnChangedField) {
          continue;
        }

        addRecomputeTarget(definition.id, event.recordId);
      }

      const eventDiff = (event.properties.diff ?? {}) as Record<
        string,
        { before?: unknown; after?: unknown } | undefined
      >;

      for (const relationField of reverseRelationFields) {
        if (relationField.relationTargetFieldMetadataId === null) {
          continue;
        }

        const inverseField = currentObjectFields.find(
          (field) => field.id === relationField.relationTargetFieldMetadataId,
        );

        if (
          inverseField === undefined ||
          !event.properties.updatedFields.includes(inverseField.name)
        ) {
          continue;
        }

        const relationChange = eventDiff[inverseField.name];
        const affectedOwnerRecordIds = new Set([
          ...collectRelatedRecordIds(relationChange?.before),
          ...collectRelatedRecordIds(relationChange?.after),
        ]);

        for (const { definition, activeVersion } of activeDefinitions) {
          if (definition.objectMetadataId !== relationField.objectMetadataId) {
            continue;
          }
          if (
            !activeVersion.dependencies.some(
              (dependency) =>
                dependency.kind === 'RELATION' &&
                dependency.relationFieldMetadataUniversalIdentifier ===
                  relationField.universalIdentifier,
            )
          ) {
            continue;
          }

          for (const ownerRecordId of affectedOwnerRecordIds) {
            addRecomputeTarget(definition.id, ownerRecordId);
          }
        }
      }
    }

    for (const { formulaDefinitionId, recordId } of [
      ...recomputeTargets.values(),
    ].sort((left, right) =>
      `${left.formulaDefinitionId}:${left.recordId}`.localeCompare(
        `${right.formulaDefinitionId}:${right.recordId}`,
      ),
    )) {
      await this.formulaApplicationService.recomputeRecord({
        workspaceId: batch.workspaceId,
        formulaDefinitionId,
        recordId,
      });
    }

    return { recomputedCount: recomputeTargets.size };
  }
}
