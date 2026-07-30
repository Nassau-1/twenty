import {
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

  it('keeps reference resolution keyed by stable metadata identity', () => {
    const compileResult = compileFormulaEditorDocument({
      document,
      resolveReference: (reference) => ({
        status:
          reference.kind === 'FIELD' &&
          reference.fieldMetadataUniversalIdentifier === 'revenue-field'
            ? 'success'
            : 'error',
        ...(reference.kind === 'FIELD' &&
        reference.fieldMetadataUniversalIdentifier === 'revenue-field'
          ? { type: 'NUMBER' as const, nullable: false }
          : { reason: 'NOT_FOUND' as const }),
      }),
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
});
