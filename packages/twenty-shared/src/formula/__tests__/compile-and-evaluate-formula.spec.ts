import {
  FORMULA_EVALUATOR_VERSION,
  FORMULA_EDITOR_DOCUMENT_VERSION,
  type FormulaEditorDocument,
  type FormulaReferenceNode,
} from '../formula-types';
import { compileFormulaEditorDocument } from '../compile-formula-editor-document';
import { evaluateCompiledFormula } from '../evaluate-compiled-formula';

const document: FormulaEditorDocument = {
  version: FORMULA_EDITOR_DOCUMENT_VERSION,
  source: 'Revenue * 2',
  references: [
    {
      kind: 'FIELD',
      fieldMetadataUniversalIdentifier: 'revenue-field',
      label: 'Revenue',
      span: { start: 0, end: 7 },
    },
  ],
};

describe('compileFormulaEditorDocument and evaluateCompiledFormula', () => {
  it('compiles and evaluates a typed numeric Formula', () => {
    const compileResult = compileFormulaEditorDocument({
      document,
      resolveReference: () => ({
        status: 'success',
        type: 'NUMBER',
        nullable: false,
      }),
    });

    expect(compileResult).toMatchObject({
      status: 'success',
      compiledFormula: {
        output: { type: 'NUMBER', nullable: false },
        dependencies: [
          {
            kind: 'FIELD',
            fieldMetadataUniversalIdentifier: 'revenue-field',
          },
        ],
      },
    });
    if (compileResult.status !== 'success') {
      throw new Error('Expected Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => ({ type: 'NUMBER', value: 125 }),
      }),
    ).toEqual({
      status: 'success',
      value: { type: 'NUMBER', value: 250 },
      evaluatorVersion: FORMULA_EVALUATOR_VERSION,
      instructionCount: 3,
    });
  });

  it('evaluates previousValue through the explicit history resolver', () => {
    const historicalDocument: FormulaEditorDocument = {
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'previousValue(Revenue) * 2',
      references: [
        {
          kind: 'FIELD',
          fieldMetadataUniversalIdentifier: 'revenue-field',
          label: 'Revenue',
          span: { start: 14, end: 21 },
        },
      ],
    };
    const compileResult = compileFormulaEditorDocument({
      document: historicalDocument,
      resolveReference: () => ({
        status: 'success',
        type: 'NUMBER',
        nullable: false,
      }),
    });

    if (compileResult.status !== 'success') {
      throw new Error('Expected historical Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => ({ type: 'NUMBER', value: 125 }),
        resolveHistoricalValue: ({ functionName, reference }) => ({
          status: 'available',
          value: {
            type: 'NUMBER',
            value:
              functionName === 'previousValue' &&
              reference.kind === 'FIELD' &&
              reference.fieldMetadataUniversalIdentifier === 'revenue-field'
                ? 100
                : 0,
          },
        }),
      }),
    ).toMatchObject({
      status: 'success',
      value: { type: 'NUMBER', value: 200 },
    });
  });

  it('fails closed when history predates ledger coverage', () => {
    const historicalDocument: FormulaEditorDocument = {
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'valueAt(Revenue, "2020-01-01T00:00:00.000Z")',
      references: [
        {
          kind: 'FIELD',
          fieldMetadataUniversalIdentifier: 'revenue-field',
          label: 'Revenue',
          span: { start: 8, end: 15 },
        },
      ],
    };
    const compileResult = compileFormulaEditorDocument({
      document: historicalDocument,
      resolveReference: () => ({
        status: 'success',
        type: 'NUMBER',
        nullable: false,
      }),
    });

    if (compileResult.status !== 'success') {
      throw new Error('Expected historical Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => ({ type: 'NUMBER', value: 125 }),
        resolveHistoricalValue: () => ({ status: 'unavailable' }),
      }),
    ).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'HISTORY_UNAVAILABLE' }],
    });
  });

  it('compiles and evaluates a bounded one-hop relation count', () => {
    const relationDocument: FormulaEditorDocument = {
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'count(People)',
      references: [
        {
          kind: 'RELATION',
          relationFieldMetadataUniversalIdentifier: 'people-relation',
          label: 'People',
          span: { start: 6, end: 12 },
        },
      ],
    };
    const compileResult = compileFormulaEditorDocument({
      document: relationDocument,
      resolveReference: (reference) =>
        reference.kind === 'RELATION'
          ? { status: 'success', type: 'RELATION', nullable: false }
          : { status: 'error', reason: 'NOT_FOUND' },
    });

    expect(compileResult).toMatchObject({
      status: 'success',
      compiledFormula: {
        output: { type: 'NUMBER', nullable: false },
        dependencies: [
          {
            kind: 'RELATION',
            relationFieldMetadataUniversalIdentifier: 'people-relation',
          },
        ],
      },
    });
    if (compileResult.status !== 'success') {
      throw new Error('Expected relation Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => ({ type: 'RELATION', value: 3 }),
      }),
    ).toEqual({
      status: 'success',
      value: { type: 'NUMBER', value: 3 },
      evaluatorVersion: FORMULA_EVALUATOR_VERSION,
      instructionCount: 2,
    });
  });

  it('rejects a bare relation and relation counts above the runtime cap', () => {
    const relationDocument: FormulaEditorDocument = {
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'People',
      references: [
        {
          kind: 'RELATION',
          relationFieldMetadataUniversalIdentifier: 'people-relation',
          label: 'People',
          span: { start: 0, end: 6 },
        },
      ],
    };
    const bareRelation = compileFormulaEditorDocument({
      document: relationDocument,
      resolveReference: () => ({
        status: 'success',
        type: 'RELATION',
        nullable: false,
      }),
    });

    expect(bareRelation).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'INCOMPATIBLE_TYPES' }],
    });

    const countedRelation = compileFormulaEditorDocument({
      document: {
        ...relationDocument,
        source: 'count(People)',
        references: [
          {
            ...relationDocument.references[0],
            span: { start: 6, end: 12 },
          },
        ],
      },
      resolveReference: () => ({
        status: 'success',
        type: 'RELATION',
        nullable: false,
      }),
    });
    if (countedRelation.status !== 'success') {
      throw new Error('Expected relation Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: countedRelation.compiledFormula,
        resolveValue: () => ({ type: 'RELATION', value: 11 }),
        limits: { maxRelationItems: 10 },
      }),
    ).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'EVALUATION_LIMIT_EXCEEDED' }],
    });
  });

  it('rejects an unauthorized dependency during compilation', () => {
    const result = compileFormulaEditorDocument({
      document,
      resolveReference: () => ({
        status: 'error',
        reason: 'NOT_AUTHORIZED',
      }),
    });

    expect(result).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'REFERENCE_NOT_AUTHORIZED' }],
    });
  });

  it('rejects incompatible arithmetic types', () => {
    const result = compileFormulaEditorDocument({
      document,
      resolveReference: () => ({
        status: 'success',
        type: 'TEXT',
        nullable: false,
      }),
    });

    expect(result).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'INCOMPATIBLE_TYPES' }],
    });
  });

  it('returns a structured division-by-zero diagnostic', () => {
    const divisionDocument: FormulaEditorDocument = {
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'Revenue / 0',
      references: document.references,
    };
    const compileResult = compileFormulaEditorDocument({
      document: divisionDocument,
      resolveReference: () => ({
        status: 'success',
        type: 'NUMBER',
        nullable: false,
      }),
    });
    if (compileResult.status !== 'success') {
      throw new Error('Expected Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => ({ type: 'NUMBER', value: 10 }),
      }),
    ).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'EVALUATION_ERROR' }],
    });
  });

  it('rejects numeric literals outside finite range', () => {
    const hugeLiteral = '9'.repeat(400);
    const compileResult = compileFormulaEditorDocument({
      document: {
        version: FORMULA_EDITOR_DOCUMENT_VERSION,
        source: hugeLiteral,
        references: [],
      },
      resolveReference: () => ({
        status: 'error',
        reason: 'NOT_FOUND',
      }),
    });
    if (compileResult.status !== 'success') {
      throw new Error('Expected Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => undefined,
      }),
    ).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'EVALUATION_ERROR' }],
    });
  });

  it('keeps reference resolution keyed by stable metadata identity', () => {
    const compileResult = compileFormulaEditorDocument({
      document,
      resolveReference: (reference) =>
        reference.kind === 'FIELD' &&
        reference.fieldMetadataUniversalIdentifier === 'revenue-field'
          ? { status: 'success', type: 'NUMBER', nullable: false }
          : { status: 'error', reason: 'NOT_FOUND' },
    });
    if (compileResult.status !== 'success') {
      throw new Error('Expected Formula compilation to succeed.');
    }

    let resolvedReference: FormulaReferenceNode['reference'] | undefined =
      undefined;
    evaluateCompiledFormula({
      compiledFormula: compileResult.compiledFormula,
      resolveValue: (reference) => {
        resolvedReference = reference;
        return { type: 'NUMBER', value: 1 };
      },
    });

    expect(resolvedReference).toEqual({
      kind: 'FIELD',
      fieldMetadataUniversalIdentifier: 'revenue-field',
    });
  });

  it('returns deterministic versioned results for the same input', () => {
    const compileResult = compileFormulaEditorDocument({
      document,
      resolveReference: () => ({
        status: 'success',
        type: 'NUMBER',
        nullable: false,
      }),
    });
    if (compileResult.status !== 'success') {
      throw new Error('Expected Formula compilation to succeed.');
    }

    const evaluate = () =>
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => ({ type: 'NUMBER', value: 125 }),
      });

    expect(evaluate()).toEqual(evaluate());
    expect(evaluate()).toMatchObject({
      evaluatorVersion: FORMULA_EVALUATOR_VERSION,
      instructionCount: 3,
    });
  });

  it('fails closed when the instruction budget is exceeded', () => {
    const compileResult = compileFormulaEditorDocument({
      document,
      resolveReference: () => ({
        status: 'success',
        type: 'NUMBER',
        nullable: false,
      }),
    });
    if (compileResult.status !== 'success') {
      throw new Error('Expected Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => ({ type: 'NUMBER', value: 125 }),
        limits: { maxInstructions: 2 },
      }),
    ).toMatchObject({
      status: 'error',
      evaluatorVersion: FORMULA_EVALUATOR_VERSION,
      diagnostics: [{ code: 'EVALUATION_LIMIT_EXCEEDED' }],
    });
  });

  it('rejects a non-finite budget instead of disabling its guard', () => {
    const compileResult = compileFormulaEditorDocument({
      document,
      resolveReference: () => ({
        status: 'success',
        type: 'NUMBER',
        nullable: false,
      }),
    });
    if (compileResult.status !== 'success') {
      throw new Error('Expected Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => ({ type: 'NUMBER', value: 125 }),
        limits: { maxInstructions: Number.POSITIVE_INFINITY },
      }),
    ).toMatchObject({
      status: 'error',
      instructionCount: 0,
      diagnostics: [{ code: 'EVALUATION_LIMIT_EXCEEDED' }],
    });
  });

  it('fails closed when a resolved text value exceeds the output budget', () => {
    const textDocument: FormulaEditorDocument = {
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'Name',
      references: [
        {
          kind: 'FIELD',
          fieldMetadataUniversalIdentifier: 'name-field',
          label: 'Name',
          span: { start: 0, end: 4 },
        },
      ],
    };
    const compileResult = compileFormulaEditorDocument({
      document: textDocument,
      resolveReference: () => ({
        status: 'success',
        type: 'TEXT',
        nullable: false,
      }),
    });
    if (compileResult.status !== 'success') {
      throw new Error('Expected Formula compilation to succeed.');
    }

    expect(
      evaluateCompiledFormula({
        compiledFormula: compileResult.compiledFormula,
        resolveValue: () => ({ type: 'TEXT', value: 'confidential' }),
        limits: { maxTextLength: 5 },
      }),
    ).toMatchObject({
      status: 'error',
      diagnostics: [
        {
          code: 'EVALUATION_LIMIT_EXCEEDED',
          message: 'Formula text result exceeds the configured limit.',
        },
      ],
    });
  });
});
