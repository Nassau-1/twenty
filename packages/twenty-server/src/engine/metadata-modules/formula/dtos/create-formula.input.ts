import { IsObject, IsOptional, IsString, IsUUID } from 'class-validator';
import { type FormulaEditorDocument } from 'twenty-shared/formula';

export class CreateFormulaInput {
  @IsUUID()
  objectMetadataId: string;

  @IsUUID()
  outputFieldMetadataId: string;

  @IsObject()
  document: FormulaEditorDocument;

  @IsOptional()
  @IsString()
  reason?: string;
}
