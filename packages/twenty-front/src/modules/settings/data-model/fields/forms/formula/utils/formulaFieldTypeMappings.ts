import { type FormulaOutputType } from 'twenty-shared/formula';
import { FieldMetadataType } from 'twenty-shared/types';

export const getFormulaTypeFromFieldMetadataType = (
  fieldType: FieldMetadataType,
): FormulaOutputType | 'RELATION' | null => {
  switch (fieldType) {
    case FieldMetadataType.NUMBER:
      return 'NUMBER';
    case FieldMetadataType.TEXT:
      return 'TEXT';
    case FieldMetadataType.BOOLEAN:
      return 'BOOLEAN';
    case FieldMetadataType.RELATION:
      return 'RELATION';
    default:
      return null;
  }
};

export const getFieldMetadataTypeFromFormulaOutputType = (
  outputType: FormulaOutputType,
):
  | FieldMetadataType.NUMBER
  | FieldMetadataType.TEXT
  | FieldMetadataType.BOOLEAN => {
  switch (outputType) {
    case 'NUMBER':
      return FieldMetadataType.NUMBER;
    case 'TEXT':
      return FieldMetadataType.TEXT;
    case 'BOOLEAN':
      return FieldMetadataType.BOOLEAN;
  }
};
