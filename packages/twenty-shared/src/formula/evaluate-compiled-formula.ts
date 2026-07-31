import {
  type CompiledFormula,
  type FormulaDiagnostic,
  type FormulaDiagnosticCode,
  type FormulaEvaluationLimits,
  type FormulaEvaluationResult,
  type FormulaNode,
  type FormulaValue,
  FORMULA_EVALUATOR_VERSION,
  type ResolveFormulaHistoricalValue,
  type ResolveFormulaValue,
} from './formula-types';

export const DEFAULT_FORMULA_EVALUATION_LIMITS: FormulaEvaluationLimits = {
  maxDepth: 64,
  maxInstructions: 1_024,
  maxTextLength: 10_000,
};

const evaluationError = (
  code: FormulaDiagnosticCode,
  message: string,
  node: FormulaNode,
): FormulaDiagnostic => ({
  code,
  message,
  span: node.span,
});

const evaluateBinary = ({
  node,
  left,
  right,
}: {
  node: Extract<FormulaNode, { kind: 'BINARY' }>;
  left: FormulaValue;
  right: FormulaValue;
}): FormulaValue => {
  if (node.operator === 'EQUAL' || node.operator === 'NOT_EQUAL') {
    const equal =
      left.type === right.type &&
      (left.type === 'NULL' ||
        (right.type !== 'NULL' && left.value === right.value));
    return {
      type: 'BOOLEAN',
      value: node.operator === 'EQUAL' ? equal : !equal,
    };
  }

  if (left.type === 'NULL' || right.type === 'NULL') {
    return { type: 'NULL', value: null };
  }

  switch (node.operator) {
    case 'PLUS':
      if (left.type === 'TEXT' && right.type === 'TEXT') {
        return { type: 'TEXT', value: left.value + right.value };
      }
      if (left.type === 'NUMBER' && right.type === 'NUMBER') {
        return { type: 'NUMBER', value: left.value + right.value };
      }
      break;
    case 'MINUS':
    case 'MULTIPLY':
    case 'DIVIDE':
      if (left.type === 'NUMBER' && right.type === 'NUMBER') {
        if (node.operator === 'DIVIDE' && right.value === 0) {
          throw evaluationError(
            'EVALUATION_ERROR',
            'Division by zero is not allowed.',
            node,
          );
        }
        const value =
          node.operator === 'MINUS'
            ? left.value - right.value
            : node.operator === 'MULTIPLY'
              ? left.value * right.value
              : left.value / right.value;
        if (!Number.isFinite(value)) {
          throw evaluationError(
            'EVALUATION_ERROR',
            'Numeric result is outside finite range.',
            node,
          );
        }
        return { type: 'NUMBER', value };
      }
      break;
    case 'AND':
    case 'OR':
      if (left.type === 'BOOLEAN' && right.type === 'BOOLEAN') {
        return {
          type: 'BOOLEAN',
          value:
            node.operator === 'AND'
              ? left.value && right.value
              : left.value || right.value,
        };
      }
      break;
    case 'GREATER_THAN':
    case 'GREATER_THAN_OR_EQUAL':
    case 'LESS_THAN':
    case 'LESS_THAN_OR_EQUAL':
      if (
        left.type === right.type &&
        (left.type === 'NUMBER' || left.type === 'TEXT')
      ) {
        const leftValue = left.value;
        const rightValue = right.value as typeof leftValue;
        const value =
          node.operator === 'GREATER_THAN'
            ? leftValue > rightValue
            : node.operator === 'GREATER_THAN_OR_EQUAL'
              ? leftValue >= rightValue
              : node.operator === 'LESS_THAN'
                ? leftValue < rightValue
                : leftValue <= rightValue;
        return { type: 'BOOLEAN', value };
      }
      break;
  }

  throw evaluationError(
    'EVALUATION_ERROR',
    'Runtime value does not match compiled type.',
    node,
  );
};

export const evaluateCompiledFormula = ({
  compiledFormula,
  resolveValue,
  resolveHistoricalValue,
  limits: requestedLimits,
}: {
  compiledFormula: CompiledFormula;
  resolveValue: ResolveFormulaValue;
  resolveHistoricalValue?: ResolveFormulaHistoricalValue;
  limits?: Partial<FormulaEvaluationLimits>;
}): FormulaEvaluationResult => {
  const limits = {
    ...DEFAULT_FORMULA_EVALUATION_LIMITS,
    ...requestedLimits,
  };
  let instructionCount = 0;

  if (
    Object.values(limits).some(
      (limit) => !Number.isSafeInteger(limit) || limit < 1,
    )
  ) {
    return {
      status: 'error',
      diagnostics: [
        evaluationError(
          'EVALUATION_LIMIT_EXCEEDED',
          'Formula evaluation limits must be positive safe integers.',
          compiledFormula.ast.root,
        ),
      ],
      evaluatorVersion: FORMULA_EVALUATOR_VERSION,
      instructionCount,
    };
  }

  const assertWithinLimits = (
    value: FormulaValue,
    node: FormulaNode,
  ): FormulaValue => {
    if (value.type === 'TEXT' && value.value.length > limits.maxTextLength) {
      throw evaluationError(
        'EVALUATION_LIMIT_EXCEEDED',
        'Formula text result exceeds the configured limit.',
        node,
      );
    }
    if (value.type === 'NUMBER' && !Number.isFinite(value.value)) {
      throw evaluationError(
        'EVALUATION_ERROR',
        'Numeric result is outside finite range.',
        node,
      );
    }

    return value;
  };

  const evaluate = (node: FormulaNode, depth = 1): FormulaValue => {
    instructionCount += 1;
    if (instructionCount > limits.maxInstructions) {
      throw evaluationError(
        'EVALUATION_LIMIT_EXCEEDED',
        'Formula instruction budget exceeded.',
        node,
      );
    }
    if (depth > limits.maxDepth) {
      throw evaluationError(
        'EVALUATION_LIMIT_EXCEEDED',
        'Formula evaluation depth exceeded.',
        node,
      );
    }

    switch (node.kind) {
      case 'LITERAL':
        if (node.value.type !== 'DECIMAL') {
          return assertWithinLimits(node.value, node);
        }
        const numericValue = Number(node.value.value);
        if (!Number.isFinite(numericValue)) {
          throw evaluationError(
            'EVALUATION_ERROR',
            'Numeric literal is outside finite range.',
            node,
          );
        }
        return { type: 'NUMBER', value: numericValue };
      case 'REFERENCE': {
        const value = resolveValue(node.reference);
        if (value === undefined) {
          throw evaluationError(
            'EVALUATION_ERROR',
            'Formula reference value could not be resolved.',
            node,
          );
        }
        return assertWithinLimits(value, node);
      }
      case 'UNARY': {
        const operand = evaluate(node.operand, depth + 1);
        if (operand.type === 'NULL') {
          return operand;
        }
        if (node.operator === '-' && operand.type === 'NUMBER') {
          return { type: 'NUMBER', value: -operand.value };
        }
        if (node.operator === 'NOT' && operand.type === 'BOOLEAN') {
          return { type: 'BOOLEAN', value: !operand.value };
        }
        throw evaluationError(
          'EVALUATION_ERROR',
          'Runtime value does not match compiled unary type.',
          node,
        );
      }
      case 'BINARY':
        return assertWithinLimits(
          evaluateBinary({
            node,
            left: evaluate(node.left, depth + 1),
            right: evaluate(node.right, depth + 1),
          }),
          node,
        );
      case 'CALL': {
        if (
          node.functionName === 'previousValue' ||
          node.functionName === 'valueAt'
        ) {
          const sourceArgument = node.arguments[0];

          if (
            sourceArgument.kind !== 'REFERENCE' ||
            sourceArgument.reference.kind !== 'FIELD' ||
            resolveHistoricalValue === undefined
          ) {
            throw evaluationError(
              'EVALUATION_ERROR',
              `${node.functionName} could not resolve its history source.`,
              node,
            );
          }

          let at: string | undefined;

          if (node.functionName === 'valueAt') {
            const atValue = evaluate(node.arguments[1], depth + 1);

            if (atValue.type !== 'TEXT') {
              throw evaluationError(
                'EVALUATION_ERROR',
                'valueAt timestamp must be TEXT.',
                node.arguments[1],
              );
            }
            at = atValue.value;
          }

          const resolution = resolveHistoricalValue({
            functionName: node.functionName,
            reference: sourceArgument.reference,
            at,
          });

          if (resolution.status === 'unavailable') {
            throw evaluationError(
              'HISTORY_UNAVAILABLE',
              'Formula history is unavailable for the requested value.',
              node,
            );
          }

          return assertWithinLimits(resolution.value, node);
        }
        if (node.functionName === 'if') {
          const condition = evaluate(node.arguments[0], depth + 1);
          if (condition.type === 'NULL') {
            return { type: 'NULL', value: null };
          }
          if (condition.type !== 'BOOLEAN') {
            throw evaluationError(
              'EVALUATION_ERROR',
              'if condition must be BOOLEAN.',
              node,
            );
          }
          return evaluate(
            condition.value ? node.arguments[1] : node.arguments[2],
            depth + 1,
          );
        }
        if (node.functionName === 'coalesce') {
          for (const argument of node.arguments) {
            const value = evaluate(argument, depth + 1);
            if (value.type !== 'NULL') {
              return value;
            }
          }
          return { type: 'NULL', value: null };
        }
        throw evaluationError(
          'EVALUATION_ERROR',
          `Function ${node.functionName} is not supported.`,
          node,
        );
      }
    }
  };

  try {
    return {
      status: 'success',
      value: evaluate(compiledFormula.ast.root),
      evaluatorVersion: FORMULA_EVALUATOR_VERSION,
      instructionCount,
    };
  } catch (caughtError) {
    if (
      typeof caughtError === 'object' &&
      caughtError !== null &&
      'code' in caughtError &&
      'span' in caughtError
    ) {
      return {
        status: 'error',
        diagnostics: [caughtError as FormulaDiagnostic],
        evaluatorVersion: FORMULA_EVALUATOR_VERSION,
        instructionCount,
      };
    }
    throw caughtError;
  }
};
