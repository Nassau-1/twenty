import {
  FORMULA_EDITOR_DOCUMENT_VERSION,
  type FormulaEditorDocument,
} from '../formula-types';
import { parseFormulaEditorDocument } from '../parse-formula-editor-document';

const fieldDocument = (
  source: string,
  label: string,
): FormulaEditorDocument => ({
  version: FORMULA_EDITOR_DOCUMENT_VERSION,
  source,
  references: [
    {
      kind: 'FIELD',
      fieldMetadataUniversalIdentifier: '20202020-1111-4111-8111-111111111111',
      label,
      span: { start: 0, end: label.length },
    },
  ],
});

describe('parseFormulaEditorDocument', () => {
  it('parses stable field references and arithmetic precedence', () => {
    const result = parseFormulaEditorDocument(
      fieldDocument('Revenue + 2 * 3', 'Revenue'),
    );

    expect(result).toMatchObject({
      status: 'success',
      ast: {
        version: 1,
        root: {
          kind: 'BINARY',
          operator: 'PLUS',
          left: {
            kind: 'REFERENCE',
            reference: {
              kind: 'FIELD',
              fieldMetadataUniversalIdentifier:
                '20202020-1111-4111-8111-111111111111',
            },
          },
          right: {
            kind: 'BINARY',
            operator: 'MULTIPLY',
          },
        },
      },
    });
  });

  it('keeps Formula definition identity distinct from raw field identity', () => {
    const result = parseFormulaEditorDocument({
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'Net Amount',
      references: [
        {
          kind: 'FORMULA',
          formulaDefinitionId: '30303030-2222-4222-8222-222222222222',
          label: 'Net Amount',
          owner: {
            scope: 'OBJECT',
            objectMetadataUniversalIdentifier:
              '40404040-3333-4333-8333-333333333333',
          },
          span: { start: 0, end: 10 },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'success',
      ast: {
        root: {
          kind: 'REFERENCE',
          reference: {
            kind: 'FORMULA',
            formulaDefinitionId: '30303030-2222-4222-8222-222222222222',
            owner: { scope: 'OBJECT' },
          },
        },
      },
    });
  });

  it('rejects a source and reference-token mismatch', () => {
    const result = parseFormulaEditorDocument(
      fieldDocument('Renamed Revenue + 1', 'Revenue'),
    );

    expect(result).toEqual({
      status: 'error',
      diagnostics: [
        {
          code: 'REFERENCE_TOKEN_SOURCE_MISMATCH',
          message: 'Reference token label does not match its source span.',
          span: { start: 0, end: 7 },
        },
      ],
    });
  });

  it('rejects overlapping reference tokens', () => {
    const result = parseFormulaEditorDocument({
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'Revenue',
      references: [
        {
          kind: 'FIELD',
          fieldMetadataUniversalIdentifier: 'field-1',
          label: 'Revenue',
          span: { start: 0, end: 7 },
        },
        {
          kind: 'FIELD',
          fieldMetadataUniversalIdentifier: 'field-2',
          label: 'venue',
          span: { start: 2, end: 7 },
        },
      ],
    });

    expect(result).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'REFERENCE_TOKEN_OVERLAP' }],
    });
  });

  it('rejects code-like syntax instead of evaluating it', () => {
    const result = parseFormulaEditorDocument({
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'process.exit(1)',
      references: [],
    });

    expect(result).toMatchObject({
      status: 'error',
      diagnostics: [{ code: 'INVALID_CHARACTER' }],
    });
  });

  it('parses conditionals as ordinary registry-bound calls', () => {
    const result = parseFormulaEditorDocument({
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: 'if(true, "ready", "blocked")',
      references: [],
    });

    expect(result).toMatchObject({
      status: 'success',
      ast: {
        root: {
          kind: 'CALL',
          functionName: 'if',
          arguments: [
            { kind: 'LITERAL', value: { type: 'BOOLEAN', value: true } },
            { kind: 'LITERAL', value: { type: 'TEXT', value: 'ready' } },
            { kind: 'LITERAL', value: { type: 'TEXT', value: 'blocked' } },
          ],
        },
      },
    });
  });
});
