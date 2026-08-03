import {
  getFieldMetadataTypeFromFormulaOutputType,
  getFormulaTypeFromFieldMetadataType,
} from '@/settings/data-model/fields/forms/formula/utils/formulaFieldTypeMappings';
import { FieldMetadataType } from 'twenty-shared/types';

describe('formulaFieldTypeMappings', () => {
  it.each([
    [FieldMetadataType.NUMBER, 'NUMBER'],
    [FieldMetadataType.TEXT, 'TEXT'],
    [FieldMetadataType.BOOLEAN, 'BOOLEAN'],
    [FieldMetadataType.RELATION, 'RELATION'],
  ] as const)('maps %s Formula sources to %s', (fieldType, formulaType) => {
    expect(getFormulaTypeFromFieldMetadataType(fieldType)).toBe(formulaType);
  });

  it('rejects unsupported Formula source types', () => {
    expect(getFormulaTypeFromFieldMetadataType(FieldMetadataType.DATE)).toBe(
      null,
    );
  });

  it.each([
    ['NUMBER', FieldMetadataType.NUMBER],
    ['TEXT', FieldMetadataType.TEXT],
    ['BOOLEAN', FieldMetadataType.BOOLEAN],
  ] as const)('maps %s Formula outputs to %s', (formulaType, fieldType) => {
    expect(getFieldMetadataTypeFromFormulaOutputType(formulaType)).toBe(
      fieldType,
    );
  });
});
