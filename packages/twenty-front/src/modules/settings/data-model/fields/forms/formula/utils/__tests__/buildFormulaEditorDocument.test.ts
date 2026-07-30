import {
  buildFormulaEditorDocument,
  normalizeFormulaNumberLiteral,
} from '@/settings/data-model/fields/forms/formula/utils/buildFormulaEditorDocument';

describe('buildFormulaEditorDocument', () => {
  it('binds the displayed field label to its stable metadata identity', () => {
    expect(
      buildFormulaEditorDocument({
        fieldMetadataUniversalIdentifier: 'revenue-field-id',
        fieldLabel: 'Annual Revenue',
        multiplierLiteral: '2.5',
      }),
    ).toEqual({
      version: 1,
      source: 'Annual Revenue * 2.5',
      references: [
        {
          kind: 'FIELD',
          fieldMetadataUniversalIdentifier: 'revenue-field-id',
          label: 'Annual Revenue',
          span: { start: 0, end: 14 },
        },
      ],
    });
  });

  it.each(['', '1e3', 'Infinity', 'NaN', '+2', '01'])(
    'rejects unsupported numeric literal %s',
    (literal) => {
      expect(normalizeFormulaNumberLiteral(literal)).toBeNull();
    },
  );

  it('normalizes a finite decimal literal', () => {
    expect(normalizeFormulaNumberLiteral('  -2.50 ')).toBe('-2.50');
  });
});
