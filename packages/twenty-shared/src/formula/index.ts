/*
 * _____                    _
 *|_   _|_      _____ _ __ | |_ _   _
 *  | | \ \ /\ / / _ \ '_ \| __| | | | Auto-generated file
 *  | |  \ V  V /  __/ | | | |_| |_| | Any edits to this will be overridden
 *  |_|   \_/\_/ \___|_| |_|\__|\__, |
 *                              |___/
 */

export { compileFormulaEditorDocument } from './compile-formula-editor-document';
export {
  DEFAULT_FORMULA_EVALUATION_LIMITS,
  evaluateCompiledFormula,
} from './evaluate-compiled-formula';
export type {
  FormulaSourceSpan,
  FormulaObjectOwner,
  FormulaListLocalOwner,
  FormulaDefinitionOwner,
  FormulaFieldReferenceToken,
  FormulaRelationReferenceToken,
  FormulaOptionReferenceToken,
  FormulaDefinitionReferenceToken,
  FormulaEditorReferenceToken,
  FormulaEditorDocument,
  FormulaLiteralNode,
  FormulaReferenceNode,
  FormulaUnaryOperator,
  FormulaUnaryNode,
  FormulaBinaryOperator,
  FormulaBinaryNode,
  FormulaCallNode,
  FormulaNode,
  FormulaAst,
  FormulaDiagnosticCode,
  FormulaDiagnostic,
  FormulaParseResult,
  FormulaValueType,
  FormulaOutputType,
  FormulaType,
  FormulaReferenceResolution,
  ResolveFormulaReference,
  CompiledFormula,
  FormulaCompileResult,
  FormulaValue,
  ResolveFormulaValue,
  FormulaHistoricalFunctionName,
  FormulaHistoricalValueRequest,
  FormulaHistoricalValueResolution,
  ResolveFormulaHistoricalValue,
  FormulaEvaluationLimits,
  FormulaEvaluationResult,
} from './formula-types';
export {
  FORMULA_EDITOR_DOCUMENT_VERSION,
  FORMULA_AST_VERSION,
  FORMULA_EVALUATOR_VERSION,
} from './formula-types';
export {
  FORMULA_SECURITY_LIMITS,
  canQueryFormulaResult,
  decideFormulaResultAccess,
} from './formula-permission-policy';
export type {
  FormulaDependencyAccess,
  FormulaMaterializationState,
  FormulaResultAccessDecision,
} from './formula-permission-policy';
export { parseFormulaEditorDocument } from './parse-formula-editor-document';
