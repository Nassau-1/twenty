import {
  type CompiledFormula,
  type FormulaBinaryNode,
  type FormulaCompileResult,
  type FormulaDiagnostic,
  type FormulaEditorDocument,
  type FormulaNode,
  type FormulaOutputType,
  type FormulaReferenceNode,
  type FormulaType,
  type ResolveFormulaReference,
} from './formula-types';
import { parseFormulaEditorDocument } from './parse-formula-editor-document';

const error = (
  code: FormulaDiagnostic['code'],
  message: string,
  node: FormulaNode,
): FormulaDiagnostic => ({
  code,
  message,
  span: node.span,
});

const requireType = ({
  actual,
  expected,
  node,
}: {
  actual: FormulaType;
  expected: FormulaOutputType;
  node: FormulaNode;
}): FormulaType => {
  if (actual.type !== expected) {
    throw error(
      'INCOMPATIBLE_TYPES',
      `Expected ${expected}, received ${actual.type}.`,
      node,
    );
  }
  return actual;
};

const inferBinaryType = (
  node: FormulaBinaryNode,
  infer: (node: FormulaNode) => FormulaType,
): FormulaType => {
  const left = infer(node.left);
  const right = infer(node.right);
  const nullable = left.nullable || right.nullable;

  switch (node.operator) {
    case 'PLUS':
      if (left.type === 'TEXT' && right.type === 'TEXT') {
        return { type: 'TEXT', nullable };
      }
      requireType({ actual: left, expected: 'NUMBER', node: node.left });
      requireType({ actual: right, expected: 'NUMBER', node: node.right });
      return { type: 'NUMBER', nullable };
    case 'DIVIDE':
    case 'MINUS':
    case 'MULTIPLY':
      requireType({ actual: left, expected: 'NUMBER', node: node.left });
      requireType({ actual: right, expected: 'NUMBER', node: node.right });
      return { type: 'NUMBER', nullable };
    case 'AND':
    case 'OR':
      requireType({ actual: left, expected: 'BOOLEAN', node: node.left });
      requireType({ actual: right, expected: 'BOOLEAN', node: node.right });
      return { type: 'BOOLEAN', nullable };
    case 'EQUAL':
    case 'NOT_EQUAL':
      if (
        left.type !== 'NULL' &&
        right.type !== 'NULL' &&
        left.type !== right.type
      ) {
        throw error(
          'INCOMPATIBLE_TYPES',
          `Cannot compare ${left.type} with ${right.type}.`,
          node,
        );
      }
      return { type: 'BOOLEAN', nullable: false };
    case 'GREATER_THAN':
    case 'GREATER_THAN_OR_EQUAL':
    case 'LESS_THAN':
    case 'LESS_THAN_OR_EQUAL':
      if (left.type !== right.type || !['NUMBER', 'TEXT'].includes(left.type)) {
        throw error(
          'INCOMPATIBLE_TYPES',
          'Ordered comparisons require matching NUMBER or TEXT operands.',
          node,
        );
      }
      return { type: 'BOOLEAN', nullable };
  }
};

const inferCallType = ({
  node,
  infer,
}: {
  node: Extract<FormulaNode, { kind: 'CALL' }>;
  infer: (node: FormulaNode) => FormulaType;
}): FormulaType => {
  const argumentTypes = node.arguments.map(infer);

  if (node.functionName === 'if') {
    if (argumentTypes.length !== 3) {
      throw error(
        'ARGUMENT_COUNT_MISMATCH',
        'if expects exactly three arguments.',
        node,
      );
    }
    requireType({
      actual: argumentTypes[0],
      expected: 'BOOLEAN',
      node: node.arguments[0],
    });
    const whenTrue = argumentTypes[1];
    const whenFalse = argumentTypes[2];
    if (
      whenTrue.type !== 'NULL' &&
      whenFalse.type !== 'NULL' &&
      whenTrue.type !== whenFalse.type
    ) {
      throw error(
        'INCOMPATIBLE_TYPES',
        'if branches must return the same type.',
        node,
      );
    }
    const outputType =
      whenTrue.type === 'NULL' ? whenFalse.type : whenTrue.type;
    return {
      type: outputType,
      nullable:
        whenTrue.nullable ||
        whenFalse.nullable ||
        whenTrue.type === 'NULL' ||
        whenFalse.type === 'NULL',
    };
  }

  if (node.functionName === 'coalesce') {
    if (argumentTypes.length < 2) {
      throw error(
        'ARGUMENT_COUNT_MISMATCH',
        'coalesce expects at least two arguments.',
        node,
      );
    }
    const nonNullTypes = argumentTypes.filter(({ type }) => type !== 'NULL');
    if (nonNullTypes.length === 0) {
      return { type: 'NULL', nullable: true };
    }
    if (nonNullTypes.some(({ type }) => type !== nonNullTypes[0].type)) {
      throw error(
        'INCOMPATIBLE_TYPES',
        'coalesce arguments must have the same non-null type.',
        node,
      );
    }
    return {
      type: nonNullTypes[0].type,
      nullable: argumentTypes.every(
        ({ nullable, type }) => nullable || type === 'NULL',
      ),
    };
  }

  throw error(
    'FUNCTION_NOT_SUPPORTED',
    `Function ${node.functionName} is not supported.`,
    node,
  );
};

export const compileFormulaEditorDocument = ({
  document,
  resolveReference,
}: {
  document: FormulaEditorDocument;
  resolveReference: ResolveFormulaReference;
}): FormulaCompileResult => {
  const parseResult = parseFormulaEditorDocument(document);
  if (parseResult.status === 'error') {
    return parseResult;
  }

  const dependencies: FormulaReferenceNode['reference'][] = [];
  const infer = (node: FormulaNode): FormulaType => {
    switch (node.kind) {
      case 'LITERAL':
        return {
          type: node.value.type === 'DECIMAL' ? 'NUMBER' : node.value.type,
          nullable: node.value.type === 'NULL',
        };
      case 'REFERENCE': {
        const resolution = resolveReference(node.reference);
        if (resolution.status === 'error') {
          throw error(
            resolution.reason === 'NOT_AUTHORIZED'
              ? 'REFERENCE_NOT_AUTHORIZED'
              : 'REFERENCE_NOT_FOUND',
            resolution.reason === 'NOT_AUTHORIZED'
              ? 'Formula reference is not authorized.'
              : 'Formula reference could not be resolved.',
            node,
          );
        }
        dependencies.push(node.reference);
        return { type: resolution.type, nullable: resolution.nullable };
      }
      case 'UNARY': {
        const operand = infer(node.operand);
        requireType({
          actual: operand,
          expected: node.operator === '-' ? 'NUMBER' : 'BOOLEAN',
          node: node.operand,
        });
        return {
          type: node.operator === '-' ? 'NUMBER' : 'BOOLEAN',
          nullable: operand.nullable,
        };
      }
      case 'BINARY':
        return inferBinaryType(node, infer);
      case 'CALL':
        return inferCallType({ node, infer });
    }
  };

  try {
    const output = infer(parseResult.ast.root);
    if (output.type === 'NULL') {
      return {
        status: 'error',
        diagnostics: [
          error(
            'INCOMPATIBLE_TYPES',
            'Formula output cannot be untyped NULL.',
            parseResult.ast.root,
          ),
        ],
      };
    }

    const compiledFormula: CompiledFormula = {
      ast: parseResult.ast,
      dependencies,
      output: {
        type: output.type,
        nullable: output.nullable,
      },
    };
    return { status: 'success', compiledFormula };
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
