import { IsObject, IsUUID } from 'class-validator';
import { type FormulaEditorDocument } from 'twenty-shared/formula';

export class PreviewFormulaInput {
  @IsUUID()
  objectMetadataId: string;

  @IsUUID()
  recordId: string;

  @IsObject()
  document: FormulaEditorDocument;
}
