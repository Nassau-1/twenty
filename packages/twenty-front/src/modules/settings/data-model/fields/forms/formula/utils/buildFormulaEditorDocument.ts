import {
  FORMULA_EDITOR_DOCUMENT_VERSION,
  type FormulaEditorDocument,
} from 'twenty-shared/formula';

const FORMULA_NUMBER_LITERAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

export const normalizeFormulaNumberLiteral = (value: string): string | null => {
  const normalizedValue = value.trim();

  if (!FORMULA_NUMBER_LITERAL_PATTERN.test(normalizedValue)) {
    return null;
  }

  return Number.isFinite(Number(normalizedValue)) ? normalizedValue : null;
};

export const buildFormulaEditorDocument = ({
  fieldMetadataUniversalIdentifier,
  fieldLabel,
  multiplierLiteral,
}: {
  fieldMetadataUniversalIdentifier: string;
  fieldLabel: string;
  multiplierLiteral: string;
}): FormulaEditorDocument => ({
  version: FORMULA_EDITOR_DOCUMENT_VERSION,
  source: `${fieldLabel} * ${multiplierLiteral}`,
  references: [
    {
      kind: 'FIELD',
      fieldMetadataUniversalIdentifier,
      label: fieldLabel,
      span: { start: 0, end: fieldLabel.length },
    },
  ],
});
