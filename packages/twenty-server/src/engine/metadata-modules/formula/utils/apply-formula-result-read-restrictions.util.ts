import {
  decideFormulaResultAccess,
  type FormulaReferenceNode,
  type FormulaResultAccessDecision,
} from 'twenty-shared/formula';
import { type ObjectsPermissions } from 'twenty-shared/types';

type FormulaPermissionVersion = {
  id: string;
  dependencies: FormulaReferenceNode['reference'][];
};

type FormulaPermissionDefinition = {
  id: string;
  activeVersionId: string | null;
  objectMetadataId: string;
  outputFieldMetadataId: string;
  versions: FormulaPermissionVersion[];
};

type FormulaPermissionField = {
  id: string;
  objectMetadataId: string;
  relationTargetObjectMetadataId?: string | null;
  universalIdentifier: string;
};

export const applyFormulaResultReadRestrictions = ({
  definitions,
  fields,
  objectsPermissions,
}: {
  definitions: FormulaPermissionDefinition[];
  fields: FormulaPermissionField[];
  objectsPermissions: ObjectsPermissions;
}): string[] => {
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const definitionsByOutputFieldId = new Map(
    definitions.map((definition) => [
      definition.outputFieldMetadataId,
      definition,
    ]),
  );
  const fieldsByUniversalIdentifier = new Map(
    fields.map((field) => [field.universalIdentifier, field]),
  );
  const decisionsByDefinitionId = new Map<
    string,
    FormulaResultAccessDecision
  >();
  const visitingDefinitionIds = new Set<string>();

  const decide = (
    definition: FormulaPermissionDefinition,
  ): FormulaResultAccessDecision => {
    const cachedDecision = decisionsByDefinitionId.get(definition.id);

    if (cachedDecision !== undefined) {
      return cachedDecision;
    }

    if (visitingDefinitionIds.has(definition.id)) {
      return { state: 'REDACTED', reason: 'UNSUPPORTED_DEPENDENCY' };
    }

    visitingDefinitionIds.add(definition.id);

    const resultObjectPermissions =
      objectsPermissions[definition.objectMetadataId];
    const activeVersion = definition.versions.find(
      ({ id }) => id === definition.activeVersionId,
    );
    const dependencies = [];
    let hasUnsupportedDependency = activeVersion === undefined;

    for (const dependency of activeVersion?.dependencies ?? []) {
      if (dependency.kind === 'RELATION') {
        const relationField = fieldsByUniversalIdentifier.get(
          dependency.relationFieldMetadataUniversalIdentifier,
        );

        if (
          relationField === undefined ||
          relationField.objectMetadataId !== definition.objectMetadataId ||
          relationField.relationTargetObjectMetadataId === null ||
          relationField.relationTargetObjectMetadataId === undefined
        ) {
          hasUnsupportedDependency = true;
          continue;
        }

        const sourceObjectPermissions =
          objectsPermissions[relationField.objectMetadataId];
        const targetObjectPermissions =
          objectsPermissions[relationField.relationTargetObjectMetadataId];

        dependencies.push({
          canReadObjectRecords:
            sourceObjectPermissions?.canReadObjectRecords === true &&
            targetObjectPermissions?.canReadObjectRecords === true &&
            targetObjectPermissions.rowLevelPermissionPredicates.length === 0 &&
            targetObjectPermissions.rowLevelPermissionPredicateGroups.length ===
              0,
          canReadFieldValue:
            sourceObjectPermissions?.restrictedFields[relationField.id]
              ?.canRead !== false,
        });
        continue;
      }

      if (dependency.kind === 'FIELD') {
        const field = fieldsByUniversalIdentifier.get(
          dependency.fieldMetadataUniversalIdentifier,
        );

        if (
          field === undefined ||
          field.objectMetadataId !== definition.objectMetadataId
        ) {
          hasUnsupportedDependency = true;
          continue;
        }

        const upstreamDefinition = definitionsByOutputFieldId.get(field.id);
        const upstreamDecision =
          upstreamDefinition === undefined
            ? undefined
            : decide(upstreamDefinition);
        const dependencyObjectPermissions =
          objectsPermissions[field.objectMetadataId];

        dependencies.push({
          canReadObjectRecords:
            dependencyObjectPermissions?.canReadObjectRecords === true,
          canReadFieldValue:
            dependencyObjectPermissions?.restrictedFields[field.id]?.canRead !==
              false && upstreamDecision?.state !== 'REDACTED',
        });
        continue;
      }

      if (dependency.kind === 'FORMULA') {
        const upstreamDefinition = definitionsById.get(
          dependency.formulaDefinitionId,
        );

        if (
          upstreamDefinition === undefined ||
          upstreamDefinition.objectMetadataId !== definition.objectMetadataId
        ) {
          hasUnsupportedDependency = true;
          continue;
        }

        const upstreamDecision = decide(upstreamDefinition);

        dependencies.push({
          canReadObjectRecords:
            objectsPermissions[upstreamDefinition.objectMetadataId]
              ?.canReadObjectRecords === true,
          canReadFieldValue: upstreamDecision.state === 'VISIBLE',
        });
        continue;
      }

      hasUnsupportedDependency = true;
    }

    const decision = decideFormulaResultAccess({
      canReadResultField:
        resultObjectPermissions?.restrictedFields[
          definition.outputFieldMetadataId
        ]?.canRead !== false,
      canReadResultObject:
        resultObjectPermissions?.canReadObjectRecords === true,
      dependencies,
      hasUnsupportedDependency,
    });

    visitingDefinitionIds.delete(definition.id);
    decisionsByDefinitionId.set(definition.id, decision);

    return decision;
  };

  const redactedOutputFieldMetadataIds: string[] = [];

  for (const definition of definitions) {
    if (decide(definition).state === 'VISIBLE') {
      continue;
    }

    const objectPermissions = objectsPermissions[definition.objectMetadataId];

    if (objectPermissions === undefined) {
      continue;
    }

    objectPermissions.restrictedFields[definition.outputFieldMetadataId] = {
      ...objectPermissions.restrictedFields[definition.outputFieldMetadataId],
      canRead: false,
    };
    redactedOutputFieldMetadataIds.push(definition.outputFieldMetadataId);
  }

  return redactedOutputFieldMetadataIds.sort();
};
