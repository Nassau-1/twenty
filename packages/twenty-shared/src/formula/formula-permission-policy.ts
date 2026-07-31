export const FORMULA_SECURITY_LIMITS = {
  maxDependenciesPerFormula: 64,
  maxDefinitionsPerObject: 100,
  maxDefinitionsPerWorkspace: 1_000,
  maxFormulaChainDepth: 3,
  maxRelationDependenciesPerFormula: 8,
  maxRelationRecordsPerEvaluation: 10_000,
} as const;

export type FormulaDependencyAccess = {
  canReadFieldValue: boolean;
  canReadObjectRecords: boolean;
};

export type FormulaResultAccessDecision =
  | { state: 'VISIBLE' }
  | {
      state: 'REDACTED';
      reason:
        | 'DEPENDENCY_NOT_READABLE'
        | 'RESULT_NOT_READABLE'
        | 'UNSUPPORTED_DEPENDENCY';
    };

export type FormulaMaterializationState =
  | 'DISABLED'
  | 'ERROR'
  | 'PENDING'
  | 'READY';

export const decideFormulaResultAccess = ({
  canReadResultField,
  canReadResultObject,
  dependencies,
  hasUnsupportedDependency = false,
}: {
  canReadResultField: boolean;
  canReadResultObject: boolean;
  dependencies: FormulaDependencyAccess[];
  hasUnsupportedDependency?: boolean;
}): FormulaResultAccessDecision => {
  if (!canReadResultObject || !canReadResultField) {
    return { state: 'REDACTED', reason: 'RESULT_NOT_READABLE' };
  }

  if (hasUnsupportedDependency) {
    return { state: 'REDACTED', reason: 'UNSUPPORTED_DEPENDENCY' };
  }

  if (
    dependencies.some(
      ({ canReadFieldValue, canReadObjectRecords }) =>
        !canReadObjectRecords || !canReadFieldValue,
    )
  ) {
    return { state: 'REDACTED', reason: 'DEPENDENCY_NOT_READABLE' };
  }

  return { state: 'VISIBLE' };
};

export const canQueryFormulaResult = ({
  access,
  materializationState,
}: {
  access: FormulaResultAccessDecision;
  materializationState: FormulaMaterializationState;
}): boolean => access.state === 'VISIBLE' && materializationState === 'READY';
