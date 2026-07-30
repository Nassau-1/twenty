export const FORMULA_EDITOR_DOCUMENT_VERSION = 1 as const;
export const FORMULA_AST_VERSION = 1 as const;

export type FormulaSourceSpan = {
  start: number;
  end: number;
};

export type FormulaObjectOwner = {
  scope: 'OBJECT';
  objectMetadataUniversalIdentifier: string;
};

export type FormulaListLocalOwner = {
  scope: 'LIST_LOCAL';
  objectMetadataUniversalIdentifier: string;
  viewUniversalIdentifier: string;
  localColumnUniversalIdentifier: string;
};

export type FormulaDefinitionOwner = FormulaObjectOwner | FormulaListLocalOwner;

type FormulaEditorReferenceTokenBase = {
  span: FormulaSourceSpan;
  label: string;
};

export type FormulaFieldReferenceToken = FormulaEditorReferenceTokenBase & {
  kind: 'FIELD';
  fieldMetadataUniversalIdentifier: string;
};

export type FormulaRelationReferenceToken = FormulaEditorReferenceTokenBase & {
  kind: 'RELATION';
  relationFieldMetadataUniversalIdentifier: string;
};

export type FormulaOptionReferenceToken = FormulaEditorReferenceTokenBase & {
  kind: 'OPTION';
  fieldMetadataUniversalIdentifier: string;
  optionId: string;
};

export type FormulaDefinitionReferenceToken =
  FormulaEditorReferenceTokenBase & {
    kind: 'FORMULA';
    formulaDefinitionId: string;
    owner: FormulaDefinitionOwner;
  };

export type FormulaEditorReferenceToken =
  | FormulaFieldReferenceToken
  | FormulaRelationReferenceToken
  | FormulaOptionReferenceToken
  | FormulaDefinitionReferenceToken;

export type FormulaEditorDocument = {
  version: typeof FORMULA_EDITOR_DOCUMENT_VERSION;
  source: string;
  references: FormulaEditorReferenceToken[];
};

export type FormulaLiteralNode = {
  kind: 'LITERAL';
  value:
    | { type: 'BOOLEAN'; value: boolean }
    | { type: 'DECIMAL'; value: string }
    | { type: 'NULL'; value: null }
    | { type: 'TEXT'; value: string };
  span: FormulaSourceSpan;
};

export type FormulaReferenceNode = {
  kind: 'REFERENCE';
  reference:
    | Omit<FormulaFieldReferenceToken, 'label' | 'span'>
    | Omit<FormulaRelationReferenceToken, 'label' | 'span'>
    | Omit<FormulaOptionReferenceToken, 'label' | 'span'>
    | Omit<FormulaDefinitionReferenceToken, 'label' | 'span'>;
  span: FormulaSourceSpan;
};

export type FormulaUnaryOperator = '-' | 'NOT';

export type FormulaUnaryNode = {
  kind: 'UNARY';
  operator: FormulaUnaryOperator;
  operand: FormulaNode;
  span: FormulaSourceSpan;
};

export type FormulaBinaryOperator =
  | 'AND'
  | 'DIVIDE'
  | 'EQUAL'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL'
  | 'MINUS'
  | 'MULTIPLY'
  | 'NOT_EQUAL'
  | 'OR'
  | 'PLUS';

export type FormulaBinaryNode = {
  kind: 'BINARY';
  operator: FormulaBinaryOperator;
  left: FormulaNode;
  right: FormulaNode;
  span: FormulaSourceSpan;
};

export type FormulaCallNode = {
  kind: 'CALL';
  functionName: string;
  arguments: FormulaNode[];
  span: FormulaSourceSpan;
};

export type FormulaNode =
  | FormulaBinaryNode
  | FormulaCallNode
  | FormulaLiteralNode
  | FormulaReferenceNode
  | FormulaUnaryNode;

export type FormulaAst = {
  version: typeof FORMULA_AST_VERSION;
  root: FormulaNode;
};

export type FormulaDiagnosticCode =
  | 'DOCUMENT_VERSION_UNSUPPORTED'
  | 'EMPTY_EXPRESSION'
  | 'EXPRESSION_TOO_DEEP'
  | 'EXPRESSION_TOO_LARGE'
  | 'INVALID_CHARACTER'
  | 'INVALID_NUMBER'
  | 'INVALID_REFERENCE_TOKEN'
  | 'INVALID_STRING'
  | 'REFERENCE_TOKEN_OVERLAP'
  | 'REFERENCE_TOKEN_SOURCE_MISMATCH'
  | 'UNEXPECTED_TOKEN';

export type FormulaDiagnostic = {
  code: FormulaDiagnosticCode;
  message: string;
  span: FormulaSourceSpan;
};

export type FormulaParseResult =
  | {
      status: 'success';
      ast: FormulaAst;
    }
  | {
      status: 'error';
      diagnostics: FormulaDiagnostic[];
    };
