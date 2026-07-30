export const FORMULA_EDITOR_DOCUMENT_VERSION = 1 as const;
export const FORMULA_AST_VERSION = 1 as const;
export const FORMULA_EVALUATOR_VERSION = '1.0.0' as const;

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
  | 'ARGUMENT_COUNT_MISMATCH'
  | 'DOCUMENT_VERSION_UNSUPPORTED'
  | 'EMPTY_EXPRESSION'
  | 'EVALUATION_ERROR'
  | 'EVALUATION_LIMIT_EXCEEDED'
  | 'EXPRESSION_TOO_DEEP'
  | 'EXPRESSION_TOO_LARGE'
  | 'FUNCTION_NOT_SUPPORTED'
  | 'INCOMPATIBLE_TYPES'
  | 'INVALID_CHARACTER'
  | 'INVALID_NUMBER'
  | 'INVALID_REFERENCE_TOKEN'
  | 'INVALID_STRING'
  | 'REFERENCE_NOT_AUTHORIZED'
  | 'REFERENCE_NOT_FOUND'
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

export type FormulaValueType = 'BOOLEAN' | 'NULL' | 'NUMBER' | 'TEXT';

export type FormulaOutputType = Exclude<FormulaValueType, 'NULL'>;

export type FormulaType = {
  type: FormulaValueType;
  nullable: boolean;
};

export type FormulaReferenceResolution =
  | {
      status: 'success';
      type: FormulaOutputType;
      nullable: boolean;
    }
  | {
      status: 'error';
      reason: 'NOT_AUTHORIZED' | 'NOT_FOUND';
    };

export type ResolveFormulaReference = (
  reference: FormulaReferenceNode['reference'],
) => FormulaReferenceResolution;

export type CompiledFormula = {
  ast: FormulaAst;
  dependencies: FormulaReferenceNode['reference'][];
  output: {
    type: FormulaOutputType;
    nullable: boolean;
  };
};

export type FormulaCompileResult =
  | {
      status: 'success';
      compiledFormula: CompiledFormula;
    }
  | {
      status: 'error';
      diagnostics: FormulaDiagnostic[];
    };

export type FormulaValue =
  | { type: 'BOOLEAN'; value: boolean }
  | { type: 'NULL'; value: null }
  | { type: 'NUMBER'; value: number }
  | { type: 'TEXT'; value: string };

export type ResolveFormulaValue = (
  reference: FormulaReferenceNode['reference'],
) => FormulaValue | undefined;

export type FormulaEvaluationLimits = {
  maxDepth: number;
  maxInstructions: number;
  maxTextLength: number;
};

type FormulaEvaluationMetadata = {
  evaluatorVersion: typeof FORMULA_EVALUATOR_VERSION;
  instructionCount: number;
};

export type FormulaEvaluationResult = FormulaEvaluationMetadata &
  (
    | {
        status: 'success';
        value: FormulaValue;
      }
    | {
        status: 'error';
        diagnostics: FormulaDiagnostic[];
      }
  );
