import {
  type CompiledFormula,
  type FormulaDiagnostic,
  type FormulaEvaluationResult,
  type FormulaNode,
  type FormulaValue,
  type ResolveFormulaValue,
} from './formula-types';

const evaluationError = (
  message: string,
  node: FormulaNode,
): FormulaDiagnostic => ({
  code: 'EVALUATION_ERROR',
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
          throw evaluationError('Division by zero is not allowed.', node);
        }
        const value =
          node.operator === 'MINUS'
            ? left.value - right.value
            : node.operator === 'MULTIPLY'
              ? left.value * right.value
              : left.value / right.value;
        if (!Number.isFinite(value)) {
          throw evaluationError(
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

  throw evaluationError('Runtime value does not match compiled type.', node);
};

export const evaluateCompiledFormula = ({
  compiledFormula,
  resolveValue,
}: {
  compiledFormula: CompiledFormula;
  resolveValue: ResolveFormulaValue;
}): FormulaEvaluationResult => {
  const evaluate = (node: FormulaNode): FormulaValue => {
    switch (node.kind) {
      case 'LITERAL':
        return node.value.type === 'DECIMAL'
          ? { type: 'NUMBER', value: Number(node.value.value) }
          : node.value;
      case 'REFERENCE': {
        const value = resolveValue(node.reference);
        if (value === undefined) {
          throw evaluationError(
            'Formula reference value could not be resolved.',
            node,
          );
        }
        return value;
      }
      case 'UNARY': {
        const operand = evaluate(node.operand);
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
          'Runtime value does not match compiled unary type.',
          node,
        );
      }
      case 'BINARY':
        return evaluateBinary({
          node,
          left: evaluate(node.left),
          right: evaluate(node.right),
        });
      case 'CALL': {
        if (node.functionName === 'if') {
          const condition = evaluate(node.arguments[0]);
          if (condition.type === 'NULL') {
            return { type: 'NULL', value: null };
          }
          if (condition.type !== 'BOOLEAN') {
            throw evaluationError('if condition must be BOOLEAN.', node);
          }
          return evaluate(
            condition.value ? node.arguments[1] : node.arguments[2],
          );
        }
        if (node.functionName === 'coalesce') {
          for (const argument of node.arguments) {
            const value = evaluate(argument);
            if (value.type !== 'NULL') {
              return value;
            }
          }
          return { type: 'NULL', value: null };
        }
        throw evaluationError(
          `Function ${node.functionName} is not supported.`,
          node,
        );
      }
    }
  };

  try {
    return { status: 'success', value: evaluate(compiledFormula.ast.root) };
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
      };
    }
    throw caughtError;
  }
};
