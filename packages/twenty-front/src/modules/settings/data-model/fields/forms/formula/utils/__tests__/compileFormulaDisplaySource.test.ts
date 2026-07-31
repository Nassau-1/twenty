import {
  buildFormulaEditorDocumentFromDisplaySource,
  compileFormulaDisplaySource,
} from '@/settings/data-model/fields/forms/formula/utils/compileFormulaDisplaySource';
import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { FieldMetadataType } from 'twenty-shared/types';

const numberField = {
  id: 'revenue-id',
  universalIdentifier: 'revenue-universal-id',
  label: 'Annual Revenue',
  type: FieldMetadataType.NUMBER,
  isNullable: true,
} as FieldMetadataItem;

const relationField = {
  id: 'people-id',
  universalIdentifier: 'people-universal-id',
  label: 'People',
  type: FieldMetadataType.RELATION,
} as FieldMetadataItem;

describe('compileFormulaDisplaySource', () => {
  it('converts visible field chips to stable backend references', () => {
    expect(
      buildFormulaEditorDocumentFromDisplaySource({
        displaySource: 'count({People}) + {Annual Revenue}',
        sourceFields: [numberField, relationField],
      }),
    ).toMatchObject({
      status: 'success',
      document: {
        version: 1,
        source: 'count(People) + Annual Revenue',
        references: [
          {
            kind: 'RELATION',
            relationFieldMetadataUniversalIdentifier: 'people-universal-id',
            label: 'People',
            span: { start: 6, end: 12 },
          },
          {
            kind: 'FIELD',
            fieldMetadataUniversalIdentifier: 'revenue-universal-id',
            label: 'Annual Revenue',
            span: { start: 16, end: 30 },
          },
        ],
      },
    });
  });

  it('does not treat braces inside strings as field references', () => {
    expect(
      buildFormulaEditorDocumentFromDisplaySource({
        displaySource: 'valueAt({Annual Revenue}, "{not a field}")',
        sourceFields: [numberField],
      }),
    ).toMatchObject({
      status: 'success',
      document: {
        source: 'valueAt(Annual Revenue, "{not a field}")',
        references: [
          {
            kind: 'FIELD',
            fieldMetadataUniversalIdentifier: 'revenue-universal-id',
          },
        ],
      },
    });
  });

  it('reports unknown field chips in display coordinates', () => {
    expect(
      compileFormulaDisplaySource({
        displaySource: 'count({Unknown})',
        sourceFields: [relationField],
      }),
    ).toEqual({
      status: 'error',
      diagnostics: [
        {
          code: 'INVALID_REFERENCE_TOKEN',
          message: 'Field "Unknown" is not available to this Formula.',
          span: { start: 6, end: 15 },
        },
      ],
    });
  });

  it('compiles a relationship count and infers Number output', () => {
    expect(
      compileFormulaDisplaySource({
        displaySource: 'count({People})',
        sourceFields: [relationField],
      }),
    ).toMatchObject({
      status: 'success',
      compiledFormula: {
        output: { type: 'NUMBER', nullable: false },
      },
    });
  });

  it('maps compiler diagnostics back across chip braces', () => {
    expect(
      compileFormulaDisplaySource({
        displaySource: '{Annual Revenue} + true',
        sourceFields: [numberField],
      }),
    ).toMatchObject({
      status: 'error',
      diagnostics: [
        {
          code: 'INCOMPATIBLE_TYPES',
          span: { start: 19, end: 23 },
        },
      ],
    });
  });
});
