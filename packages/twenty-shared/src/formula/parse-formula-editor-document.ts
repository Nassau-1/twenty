import {
  FORMULA_AST_VERSION,
  FORMULA_EDITOR_DOCUMENT_VERSION,
  type FormulaBinaryOperator,
  type FormulaDiagnostic,
  type FormulaEditorDocument,
  type FormulaEditorReferenceToken,
  type FormulaNode,
  type FormulaParseResult,
  type FormulaSourceSpan,
} from './formula-types';

const MAX_SOURCE_LENGTH = 16_384;
const MAX_LEXICAL_TOKENS = 1_024;
const MAX_AST_NODES = 512;
const MAX_AST_DEPTH = 32;

type LexicalTokenType =
  | 'AND'
  | 'BOOLEAN'
  | 'COMMA'
  | 'EOF'
  | 'EQUAL'
  | 'GREATER_THAN'
  | 'GREATER_THAN_OR_EQUAL'
  | 'IDENTIFIER'
  | 'LEFT_PAREN'
  | 'LESS_THAN'
  | 'LESS_THAN_OR_EQUAL'
  | 'MINUS'
  | 'NOT'
  | 'NOT_EQUAL'
  | 'NULL'
  | 'NUMBER'
  | 'OR'
  | 'PLUS'
  | 'REFERENCE'
  | 'RIGHT_PAREN'
  | 'SLASH'
  | 'STAR'
  | 'STRING';

type LexicalToken = {
  type: LexicalTokenType;
  span: FormulaSourceSpan;
  value?: boolean | FormulaEditorReferenceToken | string;
};

type LexResult =
  | { status: 'success'; tokens: LexicalToken[] }
  | { status: 'error'; diagnostics: FormulaDiagnostic[] };

const diagnostic = (
  code: FormulaDiagnostic['code'],
  message: string,
  span: FormulaSourceSpan,
): FormulaDiagnostic => ({ code, message, span });

const normalizeReferences = (
  document: FormulaEditorDocument,
): FormulaDiagnostic[] | FormulaEditorReferenceToken[] => {
  const references = [...document.references].sort(
    (left, right) => left.span.start - right.span.start,
  );
  let priorEnd = 0;

  for (const reference of references) {
    const { start, end } = reference.span;

    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end > document.source.length ||
      reference.label.length === 0
    ) {
      return [
        diagnostic(
          'INVALID_REFERENCE_TOKEN',
          'Reference token has an invalid source span or empty label.',
          reference.span,
        ),
      ];
    }

    if (start < priorEnd) {
      return [
        diagnostic(
          'REFERENCE_TOKEN_OVERLAP',
          'Reference tokens cannot overlap.',
          reference.span,
        ),
      ];
    }

    if (document.source.slice(start, end) !== reference.label) {
      return [
        diagnostic(
          'REFERENCE_TOKEN_SOURCE_MISMATCH',
          'Reference token label does not match its source span.',
          reference.span,
        ),
      ];
    }

    priorEnd = end;
  }

  return references;
};

const isIdentifierStart = (character: string): boolean =>
  /[A-Za-z_]/u.test(character);

const isIdentifierPart = (character: string): boolean =>
  /[A-Za-z0-9_]/u.test(character);

const lexString = ({
  source,
  start,
}: {
  source: string;
  start: number;
}):
  | { status: 'success'; end: number; value: string }
  | { status: 'error'; diagnostic: FormulaDiagnostic } => {
  const quote = source[start];
  let cursor = start + 1;
  let value = '';

  while (cursor < source.length) {
    const character = source[cursor];

    if (character === quote) {
      return { status: 'success', end: cursor + 1, value };
    }

    if (character !== '\\') {
      value += character;
      cursor += 1;
      continue;
    }

    const escapedCharacter = source[cursor + 1];
    const escapeValues: Record<string, string> = {
      '\\': '\\',
      '"': '"',
      "'": "'",
      n: '\n',
      r: '\r',
      t: '\t',
    };

    if (
      escapedCharacter === undefined ||
      escapeValues[escapedCharacter] === undefined
    ) {
      return {
        status: 'error',
        diagnostic: diagnostic(
          'INVALID_STRING',
          'String contains an unsupported escape sequence.',
          { start: cursor, end: Math.min(cursor + 2, source.length) },
        ),
      };
    }

    value += escapeValues[escapedCharacter];
    cursor += 2;
  }

  return {
    status: 'error',
    diagnostic: diagnostic(
      'INVALID_STRING',
      'String literal is not terminated.',
      { start, end: source.length },
    ),
  };
};

const lexFormulaDocument = (
  document: FormulaEditorDocument,
  references: FormulaEditorReferenceToken[],
): LexResult => {
  const tokens: LexicalToken[] = [];
  let cursor = 0;
  let referenceIndex = 0;

  const pushToken = (token: LexicalToken): FormulaDiagnostic | undefined => {
    tokens.push(token);
    if (tokens.length > MAX_LEXICAL_TOKENS) {
      return diagnostic(
        'EXPRESSION_TOO_LARGE',
        `Formula cannot contain more than ${MAX_LEXICAL_TOKENS} lexical tokens.`,
        token.span,
      );
    }
    return undefined;
  };

  while (cursor < document.source.length) {
    const reference = references[referenceIndex];
    if (reference?.span.start === cursor) {
      const sizeDiagnostic = pushToken({
        type: 'REFERENCE',
        value: reference,
        span: reference.span,
      });
      if (sizeDiagnostic !== undefined) {
        return { status: 'error', diagnostics: [sizeDiagnostic] };
      }
      cursor = reference.span.end;
      referenceIndex += 1;
      continue;
    }

    const character = document.source[cursor];
    if (/\s/u.test(character)) {
      cursor += 1;
      continue;
    }

    const tokenStart = cursor;
    const twoCharacterOperator = document.source.slice(cursor, cursor + 2);
    const twoCharacterTypes: Partial<Record<string, LexicalTokenType>> = {
      '!=': 'NOT_EQUAL',
      '<=': 'LESS_THAN_OR_EQUAL',
      '==': 'EQUAL',
      '>=': 'GREATER_THAN_OR_EQUAL',
    };
    const twoCharacterType = twoCharacterTypes[twoCharacterOperator];
    if (twoCharacterType !== undefined) {
      const sizeDiagnostic = pushToken({
        type: twoCharacterType,
        span: { start: cursor, end: cursor + 2 },
      });
      if (sizeDiagnostic !== undefined) {
        return { status: 'error', diagnostics: [sizeDiagnostic] };
      }
      cursor += 2;
      continue;
    }

    const singleCharacterTypes: Partial<Record<string, LexicalTokenType>> = {
      '+': 'PLUS',
      '-': 'MINUS',
      '*': 'STAR',
      '/': 'SLASH',
      '(': 'LEFT_PAREN',
      ')': 'RIGHT_PAREN',
      ',': 'COMMA',
      '=': 'EQUAL',
      '<': 'LESS_THAN',
      '>': 'GREATER_THAN',
    };
    const singleCharacterType = singleCharacterTypes[character];
    if (singleCharacterType !== undefined) {
      const sizeDiagnostic = pushToken({
        type: singleCharacterType,
        span: { start: cursor, end: cursor + 1 },
      });
      if (sizeDiagnostic !== undefined) {
        return { status: 'error', diagnostics: [sizeDiagnostic] };
      }
      cursor += 1;
      continue;
    }

    if (character === '"' || character === "'") {
      const stringResult = lexString({
        source: document.source,
        start: cursor,
      });
      if (stringResult.status === 'error') {
        return { status: 'error', diagnostics: [stringResult.diagnostic] };
      }
      const sizeDiagnostic = pushToken({
        type: 'STRING',
        value: stringResult.value,
        span: { start: cursor, end: stringResult.end },
      });
      if (sizeDiagnostic !== undefined) {
        return { status: 'error', diagnostics: [sizeDiagnostic] };
      }
      cursor = stringResult.end;
      continue;
    }

    if (/[0-9]/u.test(character)) {
      while (
        cursor < document.source.length &&
        /[0-9]/u.test(document.source[cursor])
      ) {
        cursor += 1;
      }
      if (document.source[cursor] === '.') {
        cursor += 1;
        const fractionStart = cursor;
        while (
          cursor < document.source.length &&
          /[0-9]/u.test(document.source[cursor])
        ) {
          cursor += 1;
        }
        if (cursor === fractionStart) {
          return {
            status: 'error',
            diagnostics: [
              diagnostic(
                'INVALID_NUMBER',
                'Decimal point must be followed by at least one digit.',
                { start: tokenStart, end: cursor },
              ),
            ],
          };
        }
      }
      const value = document.source.slice(tokenStart, cursor);
      const sizeDiagnostic = pushToken({
        type: 'NUMBER',
        value,
        span: { start: tokenStart, end: cursor },
      });
      if (sizeDiagnostic !== undefined) {
        return { status: 'error', diagnostics: [sizeDiagnostic] };
      }
      continue;
    }

    if (isIdentifierStart(character)) {
      cursor += 1;
      while (
        cursor < document.source.length &&
        isIdentifierPart(document.source[cursor])
      ) {
        cursor += 1;
      }
      const value = document.source.slice(tokenStart, cursor);
      const keywordTypes: Partial<Record<string, LexicalTokenType>> = {
        and: 'AND',
        false: 'BOOLEAN',
        not: 'NOT',
        null: 'NULL',
        or: 'OR',
        true: 'BOOLEAN',
      };
      const normalizedValue = value.toLowerCase();
      const keywordType = keywordTypes[normalizedValue];
      const sizeDiagnostic = pushToken({
        type: keywordType ?? 'IDENTIFIER',
        value: keywordType === 'BOOLEAN' ? normalizedValue === 'true' : value,
        span: { start: tokenStart, end: cursor },
      });
      if (sizeDiagnostic !== undefined) {
        return { status: 'error', diagnostics: [sizeDiagnostic] };
      }
      continue;
    }

    return {
      status: 'error',
      diagnostics: [
        diagnostic(
          'INVALID_CHARACTER',
          `Character ${JSON.stringify(character)} is not valid Formula syntax.`,
          { start: cursor, end: cursor + 1 },
        ),
      ],
    };
  }

  tokens.push({
    type: 'EOF',
    span: { start: document.source.length, end: document.source.length },
  });
  return { status: 'success', tokens };
};

class FormulaParser {
  private cursor = 0;
  private nodeCount = 0;
  private depth = 0;

  constructor(private readonly tokens: LexicalToken[]) {}

  parse(): FormulaParseResult {
    if (this.current().type === 'EOF') {
      return {
        status: 'error',
        diagnostics: [
          diagnostic(
            'EMPTY_EXPRESSION',
            'Formula expression cannot be empty.',
            this.current().span,
          ),
        ],
      };
    }

    try {
      const root = this.parseOr();
      if (this.current().type !== 'EOF') {
        throw diagnostic(
          'UNEXPECTED_TOKEN',
          'Unexpected token after the end of the expression.',
          this.current().span,
        );
      }
      return {
        status: 'success',
        ast: { version: FORMULA_AST_VERSION, root },
      };
    } catch (error) {
      return {
        status: 'error',
        diagnostics: [
          isFormulaDiagnostic(error)
            ? error
            : diagnostic(
                'UNEXPECTED_TOKEN',
                'Formula could not be parsed.',
                this.current().span,
              ),
        ],
      };
    }
  }

  private parseOr(): FormulaNode {
    return this.parseBinary(() => this.parseAnd(), {
      OR: 'OR',
    });
  }

  private parseAnd(): FormulaNode {
    return this.parseBinary(() => this.parseEquality(), {
      AND: 'AND',
    });
  }

  private parseEquality(): FormulaNode {
    return this.parseBinary(() => this.parseComparison(), {
      EQUAL: 'EQUAL',
      NOT_EQUAL: 'NOT_EQUAL',
    });
  }

  private parseComparison(): FormulaNode {
    return this.parseBinary(() => this.parseAdditive(), {
      GREATER_THAN: 'GREATER_THAN',
      GREATER_THAN_OR_EQUAL: 'GREATER_THAN_OR_EQUAL',
      LESS_THAN: 'LESS_THAN',
      LESS_THAN_OR_EQUAL: 'LESS_THAN_OR_EQUAL',
    });
  }

  private parseAdditive(): FormulaNode {
    return this.parseBinary(() => this.parseMultiplicative(), {
      MINUS: 'MINUS',
      PLUS: 'PLUS',
    });
  }

  private parseMultiplicative(): FormulaNode {
    return this.parseBinary(() => this.parseUnary(), {
      SLASH: 'DIVIDE',
      STAR: 'MULTIPLY',
    });
  }

  private parseBinary(
    parseOperand: () => FormulaNode,
    operators: Partial<Record<LexicalTokenType, FormulaBinaryOperator>>,
  ): FormulaNode {
    let left = parseOperand();
    while (operators[this.current().type] !== undefined) {
      const operator = operators[this.advance().type] as FormulaBinaryOperator;
      const right = parseOperand();
      left = this.createNode({
        kind: 'BINARY',
        operator,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      });
    }
    return left;
  }

  private parseUnary(): FormulaNode {
    const current = this.current();
    if (current.type === 'MINUS' || current.type === 'NOT') {
      this.advance();
      const operand = this.withDepth(() => this.parseUnary());
      return this.createNode({
        kind: 'UNARY',
        operator: current.type === 'MINUS' ? '-' : 'NOT',
        operand,
        span: { start: current.span.start, end: operand.span.end },
      });
    }
    return this.parsePrimary();
  }

  private parsePrimary(): FormulaNode {
    const token = this.advance();
    switch (token.type) {
      case 'BOOLEAN':
        return this.createNode({
          kind: 'LITERAL',
          value: { type: 'BOOLEAN', value: token.value as boolean },
          span: token.span,
        });
      case 'NULL':
        return this.createNode({
          kind: 'LITERAL',
          value: { type: 'NULL', value: null },
          span: token.span,
        });
      case 'NUMBER':
        return this.createNode({
          kind: 'LITERAL',
          value: { type: 'DECIMAL', value: token.value as string },
          span: token.span,
        });
      case 'STRING':
        return this.createNode({
          kind: 'LITERAL',
          value: { type: 'TEXT', value: token.value as string },
          span: token.span,
        });
      case 'REFERENCE': {
        const reference = token.value as FormulaEditorReferenceToken;
        const { label: _label, span: _span, ...stableReference } = reference;
        return this.createNode({
          kind: 'REFERENCE',
          reference: stableReference,
          span: token.span,
        });
      }
      case 'IDENTIFIER':
        return this.parseCall(token);
      case 'LEFT_PAREN': {
        const expression = this.withDepth(() => this.parseOr());
        const rightParen = this.expect(
          'RIGHT_PAREN',
          'Expected a closing parenthesis.',
        );
        return {
          ...expression,
          span: { start: token.span.start, end: rightParen.span.end },
        };
      }
      default:
        throw diagnostic(
          'UNEXPECTED_TOKEN',
          'Expected a literal, reference, function call, or parenthesized expression.',
          token.span,
        );
    }
  }

  private parseCall(identifier: LexicalToken): FormulaNode {
    this.expect(
      'LEFT_PAREN',
      'Bare identifiers are not valid Formula references.',
    );
    const args: FormulaNode[] = [];

    if (this.current().type !== 'RIGHT_PAREN') {
      do {
        args.push(this.withDepth(() => this.parseOr()));
      } while (this.match('COMMA'));
    }

    const rightParen = this.expect(
      'RIGHT_PAREN',
      'Expected a closing parenthesis after function arguments.',
    );
    const lowerCaseFunctionName = String(identifier.value).toLowerCase();
    const functionName =
      lowerCaseFunctionName === 'previousvalue'
        ? 'previousValue'
        : lowerCaseFunctionName === 'valueat'
          ? 'valueAt'
          : lowerCaseFunctionName;

    return this.createNode({
      kind: 'CALL',
      functionName,
      arguments: args,
      span: { start: identifier.span.start, end: rightParen.span.end },
    });
  }

  private withDepth<T>(callback: () => T): T {
    this.depth += 1;
    if (this.depth > MAX_AST_DEPTH) {
      throw diagnostic(
        'EXPRESSION_TOO_DEEP',
        `Formula cannot exceed ${MAX_AST_DEPTH} nested expressions.`,
        this.current().span,
      );
    }
    try {
      return callback();
    } finally {
      this.depth -= 1;
    }
  }

  private createNode<T extends FormulaNode>(node: T): T {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_AST_NODES) {
      throw diagnostic(
        'EXPRESSION_TOO_LARGE',
        `Formula cannot contain more than ${MAX_AST_NODES} AST nodes.`,
        node.span,
      );
    }
    return node;
  }

  private current(): LexicalToken {
    return this.tokens[this.cursor];
  }

  private advance(): LexicalToken {
    const token = this.current();
    if (token.type !== 'EOF') {
      this.cursor += 1;
    }
    return token;
  }

  private match(type: LexicalTokenType): boolean {
    if (this.current().type !== type) {
      return false;
    }
    this.advance();
    return true;
  }

  private expect(type: LexicalTokenType, message: string): LexicalToken {
    if (this.current().type !== type) {
      throw diagnostic('UNEXPECTED_TOKEN', message, this.current().span);
    }
    return this.advance();
  }
}

const isFormulaDiagnostic = (value: unknown): value is FormulaDiagnostic =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  'message' in value &&
  'span' in value;

export const parseFormulaEditorDocument = (
  document: FormulaEditorDocument,
): FormulaParseResult => {
  if (document.version !== FORMULA_EDITOR_DOCUMENT_VERSION) {
    return {
      status: 'error',
      diagnostics: [
        diagnostic(
          'DOCUMENT_VERSION_UNSUPPORTED',
          `Formula editor document version ${document.version} is not supported.`,
          { start: 0, end: 0 },
        ),
      ],
    };
  }

  if (document.source.length > MAX_SOURCE_LENGTH) {
    return {
      status: 'error',
      diagnostics: [
        diagnostic(
          'EXPRESSION_TOO_LARGE',
          `Formula source cannot exceed ${MAX_SOURCE_LENGTH} characters.`,
          { start: MAX_SOURCE_LENGTH, end: document.source.length },
        ),
      ],
    };
  }

  const references = normalizeReferences(document);
  if (references.length > 0 && 'code' in references[0]) {
    return {
      status: 'error',
      diagnostics: references as FormulaDiagnostic[],
    };
  }

  const lexResult = lexFormulaDocument(
    document,
    references as FormulaEditorReferenceToken[],
  );
  if (lexResult.status === 'error') {
    return lexResult;
  }

  return new FormulaParser(lexResult.tokens).parse();
};
