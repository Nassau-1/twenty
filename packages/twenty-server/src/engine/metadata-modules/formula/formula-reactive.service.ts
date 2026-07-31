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
        where: {
          workspaceId: batch.workspaceId,
          objectMetadataId: batch.objectMetadata.id,
        },
      }),
      this.formulaDefinitionRepository.find(batch.workspaceId, {
        where: { objectMetadataId: batch.objectMetadata.id },
        relations: { versions: true },
      }),
    ]);
    const fieldUniversalIdentifierByName = new Map(
      fields.map((field) => [field.name, field.universalIdentifier]),
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
      definitions.map((definition) => definition.outputFieldMetadataId),
    );
    const fieldMetadataIdByUniversalIdentifier = new Map(
      fields.map((field) => [field.universalIdentifier, field.id]),
    );
    const trackedFieldMetadataIds = new Set(
      activeDefinitions
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

    let recomputedCount = 0;

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
        const dependsOnChangedField = activeVersion.dependencies.some(
          (dependency) =>
            dependency.kind === 'FIELD' &&
            changedFieldUniversalIdentifiers.has(
              dependency.fieldMetadataUniversalIdentifier,
            ),
        );

        if (!dependsOnChangedField) {
          continue;
        }

        await this.formulaApplicationService.recomputeRecord({
          workspaceId: batch.workspaceId,
          formulaDefinitionId: definition.id,
          recordId: event.recordId,
        });
        recomputedCount += 1;
      }
    }

    return { recomputedCount };
  }
}
