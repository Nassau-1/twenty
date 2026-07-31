import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import {
  compileFormulaEditorDocument,
  FORMULA_EDITOR_DOCUMENT_VERSION,
  type FormulaCompileResult,
  type FormulaDiagnostic,
  type FormulaEditorDocument,
  type ResolveFormulaReference,
  type FormulaSourceSpan,
} from 'twenty-shared/formula';
import { FieldMetadataType } from 'twenty-shared/types';

type FormulaDisplaySourceBuildResult =
  | {
      status: 'success';
      document: FormulaEditorDocument;
      backendBoundaryToDisplayBoundary: number[];
    }
  | {
      status: 'error';
      diagnostics: FormulaDiagnostic[];
    };

export type FormulaDisplaySourceCompileResult =
  | {
      status: 'success';
      document: FormulaEditorDocument;
      compiledFormula: Extract<
        FormulaCompileResult,
        { status: 'success' }
      >['compiledFormula'];
    }
  | {
      status: 'error';
      diagnostics: FormulaDiagnostic[];
      document?: FormulaEditorDocument;
    };

const diagnostic = (
  message: string,
  span: FormulaSourceSpan,
): FormulaDiagnostic => ({
  code: 'INVALID_REFERENCE_TOKEN',
  message,
  span,
});

const mapBackendSpanToDisplaySpan = ({
  span,
  backendBoundaryToDisplayBoundary,
  displaySourceLength,
}: {
  span: FormulaSourceSpan;
  backendBoundaryToDisplayBoundary: number[];
  displaySourceLength: number;
}): FormulaSourceSpan => ({
  start: backendBoundaryToDisplayBoundary[span.start] ?? displaySourceLength,
  end: backendBoundaryToDisplayBoundary[span.end] ?? displaySourceLength,
});

export const buildFormulaEditorDocumentFromDisplaySource = ({
  displaySource,
  sourceFields,
}: {
  displaySource: string;
  sourceFields: FieldMetadataItem[];
}): FormulaDisplaySourceBuildResult => {
  const fieldsByLabel = new Map<string, FieldMetadataItem>();

  for (const field of sourceFields) {
    if (fieldsByLabel.has(field.label)) {
      return {
        status: 'error',
        diagnostics: [
          diagnostic(
            `The field label ${JSON.stringify(field.label)} is ambiguous.`,
            { start: 0, end: displaySource.length },
          ),
        ],
      };
    }

    fieldsByLabel.set(field.label, field);
  }

  let backendSource = '';
  const references: FormulaEditorDocument['references'] = [];
  const backendBoundaryToDisplayBoundary = [0];
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let cursor = 0; cursor < displaySource.length; cursor += 1) {
    const character = displaySource[cursor];

    if (quote !== null) {
      backendSource += character;
      backendBoundaryToDisplayBoundary.push(cursor + 1);

      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
      backendSource += character;
      backendBoundaryToDisplayBoundary.push(cursor + 1);
      continue;
    }

    if (character === '}') {
      return {
        status: 'error',
        diagnostics: [
          diagnostic('Field reference has an unmatched closing brace.', {
            start: cursor,
            end: cursor + 1,
          }),
        ],
      };
    }

    if (character !== '{') {
      backendSource += character;
      backendBoundaryToDisplayBoundary.push(cursor + 1);
      continue;
    }

    const closingBraceIndex = displaySource.indexOf('}', cursor + 1);

    if (closingBraceIndex === -1) {
      return {
        status: 'error',
        diagnostics: [
          diagnostic('Field reference is missing a closing brace.', {
            start: cursor,
            end: displaySource.length,
          }),
        ],
      };
    }

    const fieldLabel = displaySource.slice(cursor + 1, closingBraceIndex);
    const field = fieldsByLabel.get(fieldLabel);

    if (field === undefined) {
      return {
        status: 'error',
        diagnostics: [
          diagnostic(
            `Field ${JSON.stringify(fieldLabel)} is not available to this Formula.`,
            { start: cursor, end: closingBraceIndex + 1 },
          ),
        ],
      };
    }

    const referenceStart = backendSource.length;

    backendBoundaryToDisplayBoundary[referenceStart] = cursor + 1;
    for (
      let fieldCursor = 0;
      fieldCursor < fieldLabel.length;
      fieldCursor += 1
    ) {
      backendSource += fieldLabel[fieldCursor];
      backendBoundaryToDisplayBoundary.push(cursor + fieldCursor + 2);
    }

    const span = {
      start: referenceStart,
      end: backendSource.length,
    };

    references.push(
      field.type === FieldMetadataType.RELATION
        ? {
            kind: 'RELATION',
            relationFieldMetadataUniversalIdentifier: field.universalIdentifier,
            label: fieldLabel,
            span,
          }
        : {
            kind: 'FIELD',
            fieldMetadataUniversalIdentifier: field.universalIdentifier,
            label: fieldLabel,
            span,
          },
    );

    cursor = closingBraceIndex;
    backendBoundaryToDisplayBoundary[backendSource.length] = closingBraceIndex;
  }

  return {
    status: 'success',
    document: {
      version: FORMULA_EDITOR_DOCUMENT_VERSION,
      source: backendSource,
      references,
    },
    backendBoundaryToDisplayBoundary,
  };
};

export const compileFormulaDisplaySource = ({
  displaySource,
  sourceFields,
}: {
  displaySource: string;
  sourceFields: FieldMetadataItem[];
}): FormulaDisplaySourceCompileResult => {
  const buildResult = buildFormulaEditorDocumentFromDisplaySource({
    displaySource,
    sourceFields,
  });

  if (buildResult.status === 'error') {
    return buildResult;
  }

  const fieldsByUniversalIdentifier = new Map(
    sourceFields.map((field) => [field.universalIdentifier, field]),
  );
  const resolveReference = (
    reference: Parameters<ResolveFormulaReference>[0],
  ) => {
    const universalIdentifier =
      reference.kind === 'RELATION'
        ? reference.relationFieldMetadataUniversalIdentifier
        : reference.kind === 'FIELD'
          ? reference.fieldMetadataUniversalIdentifier
          : null;
    const field =
      universalIdentifier === null
        ? undefined
        : fieldsByUniversalIdentifier.get(universalIdentifier);

    if (field?.type === FieldMetadataType.RELATION) {
      return { status: 'success', type: 'RELATION', nullable: false };
    }

    if (field?.type === FieldMetadataType.NUMBER) {
      return {
        status: 'success',
        type: 'NUMBER',
        nullable: field.isNullable !== false,
      };
    }

    return { status: 'error', reason: 'NOT_FOUND' };
  };
  const compileResult = compileFormulaEditorDocument({
    document: buildResult.document,
    resolveReference: resolveReference as unknown as ResolveFormulaReference,
  });

  if (compileResult.status === 'error') {
    return {
      status: 'error',
      document: buildResult.document,
      diagnostics: compileResult.diagnostics.map((item) => ({
        ...item,
        span: mapBackendSpanToDisplaySpan({
          span: item.span,
          backendBoundaryToDisplayBoundary:
            buildResult.backendBoundaryToDisplayBoundary,
          displaySourceLength: displaySource.length,
        }),
      })),
    };
  }

  if (compileResult.compiledFormula.output.type !== 'NUMBER') {
    return {
      status: 'error',
      document: buildResult.document,
      diagnostics: [
        {
          code: 'INCOMPATIBLE_TYPES',
          message: 'Formula output must be a Number.',
          span: { start: 0, end: displaySource.length },
        },
      ],
    };
  }

  return {
    status: 'success',
    document: buildResult.document,
    compiledFormula: compileResult.compiledFormula,
  };
};
