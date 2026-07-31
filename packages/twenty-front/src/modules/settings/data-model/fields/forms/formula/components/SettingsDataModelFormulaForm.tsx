import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { useRecordsForSelect } from '@/object-record/select/hooks/useRecordsForSelect';
import {
  previewFormulaMetadata,
  type FormulaPreviewApiResult,
} from '@/settings/data-model/fields/forms/formula/services/formulaMetadataApi';
import {
  compileFormulaDisplaySource,
  type FormulaDisplaySourceCompileResult,
} from '@/settings/data-model/fields/forms/formula/utils/compileFormulaDisplaySource';
import { MONOSPACE_FONT_FAMILY } from '@/ui/theme/constants/MonospaceFontFamily';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { type Monaco } from '@monaco-editor/react';
import { type editor } from 'monaco-editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconArrowBackUp,
  IconCheck,
  IconPlayerPlay,
  IconRefresh,
} from 'twenty-ui/icon';
import {
  Button,
  CodeEditor,
  LightIconButton,
  SearchInput,
} from 'twenty-ui/input';
import { Section } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { H2Title } from 'twenty-ui/typography';
import { Select } from '@/ui/input/components/Select';
import { FieldMetadataType } from 'twenty-shared/types';

const FORMULA_LANGUAGE_ID = 'zo-formula';

const FORMULA_FUNCTIONS = [
  { name: 'count', signature: 'count(relation)' },
  { name: 'if', signature: 'if(condition, whenTrue, whenFalse)' },
  { name: 'coalesce', signature: 'coalesce(value, fallback)' },
  { name: 'previousValue', signature: 'previousValue(field)' },
  { name: 'valueAt', signature: 'valueAt(field, timestamp)' },
] as const;

const StyledEditorLayout = styled.div`
  border: 1px solid ${themeCssVariables.border.color.medium};
  border-radius: ${themeCssVariables.border.radius.sm};
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(220px, 0.34fr);
  margin-top: ${themeCssVariables.spacing[3]};
  min-height: 300px;
  overflow: hidden;

  @media (max-width: 800px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const StyledEditorColumn = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const StyledToolbar = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  justify-content: space-between;
  min-height: 36px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

const StyledToolbarGroup = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledOutput = styled.div<{ isValid: boolean }>`
  align-items: center;
  color: ${({ isValid }) =>
    isValid
      ? themeCssVariables.font.color.secondary
      : themeCssVariables.color.red};
  display: flex;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[1]};
`;

const StyledHelper = styled.aside`
  border-left: 1px solid ${themeCssVariables.border.color.light};
  display: flex;
  flex-direction: column;
  max-height: 360px;
  min-width: 0;
  overflow: auto;
  padding: ${themeCssVariables.spacing[3]};

  @media (max-width: 800px) {
    border-left: 0;
    border-top: 1px solid ${themeCssVariables.border.color.light};
    max-height: 280px;
  }
`;

const StyledHelperHeading = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  font-size: ${themeCssVariables.font.size.sm};
  font-weight: ${themeCssVariables.font.weight.semiBold};
  margin: ${themeCssVariables.spacing[3]} 0 ${themeCssVariables.spacing[1]};
`;

const StyledHelperButton = styled.button`
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: ${themeCssVariables.border.radius.sm};
  color: ${themeCssVariables.font.color.primary};
  cursor: pointer;
  display: flex;
  font-family: inherit;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[2]};
  justify-content: space-between;
  min-height: 28px;
  padding: 0 ${themeCssVariables.spacing[2]};
  text-align: left;
  width: 100%;

  &:hover,
  &:focus-visible {
    background: ${themeCssVariables.background.transparent.light};
    outline: none;
  }
`;

const StyledFunctionSignature = styled.span`
  color: ${themeCssVariables.font.color.tertiary};
  font-family: ${MONOSPACE_FONT_FAMILY};
  font-size: ${themeCssVariables.font.size.xs};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledDiagnostics = styled.div`
  border-top: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.color.red};
  display: grid;
  font-size: ${themeCssVariables.font.size.sm};
  gap: ${themeCssVariables.spacing[1]};
  padding: ${themeCssVariables.spacing[2]} ${themeCssVariables.spacing[3]};
`;

const StyledPreview = styled.div`
  align-items: end;
  display: grid;
  gap: ${themeCssVariables.spacing[2]};
  grid-template-columns: minmax(0, 1fr) auto;
  margin-top: ${themeCssVariables.spacing[4]};
  width: 100%;

  @media (max-width: 480px) {
    align-items: stretch;
    grid-template-columns: minmax(0, 1fr);
  }
`;

const StyledPreviewResult = styled.div`
  align-items: center;
  border-bottom: 1px solid ${themeCssVariables.border.color.light};
  color: ${themeCssVariables.font.color.primary};
  display: flex;
  font-variant-numeric: tabular-nums;
  justify-content: space-between;
  min-height: 36px;
  padding: 0 ${themeCssVariables.spacing[2]};
`;

const offsetToPosition = (source: string, offset: number) => {
  const boundedOffset = Math.max(0, Math.min(offset, source.length));
  const precedingSource = source.slice(0, boundedOffset);
  const lines = precedingSource.split('\n');

  return {
    lineNumber: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
};

type SettingsDataModelFormulaFormProps = {
  sourceFields: FieldMetadataItem[];
  formulaSource: string;
  onFormulaSourceChange: (value: string) => void;
  compileResult: FormulaDisplaySourceCompileResult;
  objectMetadataId: string;
  objectNameSingular: string;
};

export const SettingsDataModelFormulaForm = ({
  sourceFields,
  formulaSource,
  onFormulaSourceChange,
  compileResult,
  objectMetadataId,
  objectNameSingular,
}: SettingsDataModelFormulaFormProps) => {
  const { t } = useLingui();
  // Monaco exposes its command surface through an imperative editor handle.
  // oxlint-disable-next-line twenty/no-state-useref
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  // The provider is an external disposable, not render state.
  // oxlint-disable-next-line twenty/no-state-useref
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null);
  const [helperSearch, setHelperSearch] = useState('');
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [previewResult, setPreviewResult] =
    useState<FormulaPreviewApiResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const {
    recordsToSelect,
    selectedRecords,
    loading: recordsLoading,
  } = useRecordsForSelect({
    searchFilterText: '',
    selectedIds: selectedRecordId === '' ? [] : [selectedRecordId],
    limit: 20,
    objectNameSingular,
    allowRequestsToTwentyIcons: false,
  });

  useEffect(() => {
    return () => completionProviderRef.current?.dispose();
  }, []);

  useEffect(() => {
    setPreviewResult(null);
    setPreviewError(null);
  }, [formulaSource, selectedRecordId]);

  const normalizedSearch = helperSearch.trim().toLocaleLowerCase();
  const filteredFields = useMemo(
    () =>
      sourceFields.filter((field) =>
        field.label.toLocaleLowerCase().includes(normalizedSearch),
      ),
    [normalizedSearch, sourceFields],
  );
  const filteredFunctions = useMemo(
    () =>
      FORMULA_FUNCTIONS.filter(({ name, signature }) =>
        `${name} ${signature}`.toLocaleLowerCase().includes(normalizedSearch),
      ),
    [normalizedSearch],
  );
  const previewRecords = useMemo(
    () => [...selectedRecords, ...recordsToSelect],
    [recordsToSelect, selectedRecords],
  );

  const insertSource = (source: string, cursorOffset = 0) => {
    const formulaEditor = editorRef.current;
    const selection = formulaEditor?.getSelection();

    if (formulaEditor === null || formulaEditor === undefined || !selection) {
      onFormulaSourceChange(`${formulaSource}${source}`);
      return;
    }

    formulaEditor.executeEdits('formula-helper', [
      {
        range: selection,
        text: source,
        forceMoveMarkers: true,
      },
    ]);
    const start = selection.getStartPosition();
    const model = formulaEditor.getModel();

    if (model !== null) {
      const startOffset = model.getOffsetAt(start);
      formulaEditor.setPosition(
        model.getPositionAt(startOffset + source.length + cursorOffset),
      );
    }

    formulaEditor.focus();
  };

  const handleEditorDidMount = (
    formulaEditor: editor.IStandaloneCodeEditor,
    monaco: Monaco,
  ) => {
    editorRef.current = formulaEditor;

    if (
      !monaco.languages
        .getLanguages()
        .some(({ id }) => id === FORMULA_LANGUAGE_ID)
    ) {
      monaco.languages.register({ id: FORMULA_LANGUAGE_ID });
      monaco.languages.setMonarchTokensProvider(FORMULA_LANGUAGE_ID, {
        tokenizer: {
          root: [
            [/\{[^}]+\}/u, 'variable'],
            [
              /\b(?:count|if|coalesce|previousValue|valueAt)(?=\s*\()/u,
              'keyword',
            ],
            [/\b(?:true|false|null|and|or|not)\b/iu, 'keyword'],
            [/-?(?:0|[1-9]\d*)(?:\.\d+)?/u, 'number'],
            [/["'](?:\\.|[^\\"'])*["']/u, 'string'],
          ],
        },
      });
    }

    completionProviderRef.current?.dispose();
    completionProviderRef.current =
      monaco.languages.registerCompletionItemProvider(FORMULA_LANGUAGE_ID, {
        triggerCharacters: ['{'],
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const characterBeforeWord = model.getValueInRange({
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: Math.max(1, word.startColumn - 1),
            endColumn: word.startColumn,
          });
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn:
              characterBeforeWord === '{'
                ? Math.max(1, word.startColumn - 1)
                : word.startColumn,
            endColumn: word.endColumn,
          };

          return {
            suggestions: [
              ...sourceFields.map((field) => ({
                label: field.label,
                kind: monaco.languages.CompletionItemKind.Field,
                insertText: `{${field.label}}`,
                range,
              })),
              ...FORMULA_FUNCTIONS.map(({ name, signature }) => ({
                label: name,
                detail: signature,
                kind: monaco.languages.CompletionItemKind.Function,
                insertText: `${name}($0)`,
                insertTextRules:
                  monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                range,
              })),
            ],
          };
        },
      });
  };

  const getMarkers = (source: string): editor.IMarkerData[] => {
    const currentCompileResult = compileFormulaDisplaySource({
      displaySource: source,
      sourceFields,
    });

    return currentCompileResult.status === 'success'
      ? []
      : currentCompileResult.diagnostics.map((item) => {
          const start = offsetToPosition(source, item.span.start);
          const rawEnd = offsetToPosition(source, item.span.end);
          const end =
            rawEnd.lineNumber === start.lineNumber &&
            rawEnd.column <= start.column
              ? { ...rawEnd, column: start.column + 1 }
              : rawEnd;

          return {
            severity: 8,
            message: item.message,
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column,
          };
        });
  };

  const handleValidate = () => {
    if (compileResult.status === 'success') {
      editorRef.current?.focus();
      return;
    }

    const firstDiagnostic = compileResult.diagnostics[0];
    editorRef.current?.setPosition(
      offsetToPosition(formulaSource, firstDiagnostic.span.start),
    );
    editorRef.current?.focus();
  };

  const handlePreview = async () => {
    if (compileResult.status !== 'success' || selectedRecordId === '') {
      return;
    }

    setIsPreviewing(true);
    setPreviewError(null);

    try {
      setPreviewResult(
        await previewFormulaMetadata({
          objectMetadataId,
          recordId: selectedRecordId,
          document: compileResult.document,
        }),
      );
    } catch (error) {
      setPreviewResult(null);
      setPreviewError(
        error instanceof Error ? error.message : t`Preview failed.`,
      );
    } finally {
      setIsPreviewing(false);
    }
  };

  return (
    <Section>
      <H2Title title={t`Formula`} description={t`Number output`} />
      <StyledEditorLayout>
        <StyledEditorColumn>
          <StyledToolbar>
            <StyledToolbarGroup>
              <LightIconButton
                Icon={IconArrowBackUp}
                onClick={() =>
                  editorRef.current?.trigger('formula', 'undo', null)
                }
                title={t`Undo`}
                size="small"
                accent="tertiary"
              />
              <LightIconButton
                Icon={IconRefresh}
                onClick={() =>
                  editorRef.current?.trigger('formula', 'redo', null)
                }
                title={t`Redo`}
                size="small"
                accent="tertiary"
              />
            </StyledToolbarGroup>
            <StyledToolbarGroup>
              <StyledOutput isValid={compileResult.status === 'success'}>
                {compileResult.status === 'success' && <IconCheck size={14} />}
                {compileResult.status === 'success'
                  ? t`Output: Number`
                  : t`Formula has errors`}
              </StyledOutput>
              <LightIconButton
                Icon={IconCheck}
                onClick={handleValidate}
                title={t`Validate`}
                size="small"
                accent="tertiary"
              />
            </StyledToolbarGroup>
          </StyledToolbar>
          <CodeEditor
            height={220}
            value={formulaSource}
            language={FORMULA_LANGUAGE_ID}
            onChange={onFormulaSourceChange}
            onMount={handleEditorDidMount}
            setMarkers={getMarkers}
            variant="borderless"
            contentPadding="comfortable"
            options={{
              ariaLabel: t`Formula expression`,
              automaticLayout: true,
              folding: false,
              fontSize: 13,
              lineNumbers: 'on',
              lineNumbersMinChars: 2,
              renderLineHighlight: 'line',
              tabSize: 2,
              wordWrap: 'on',
            }}
          />
          {compileResult.status === 'error' && (
            <StyledDiagnostics role="alert">
              {compileResult.diagnostics.slice(0, 3).map((item, index) => (
                <div key={`${item.code}-${item.span.start}-${index}`}>
                  {item.message}
                </div>
              ))}
            </StyledDiagnostics>
          )}
        </StyledEditorColumn>
        <StyledHelper aria-label={t`Formula helper`}>
          <SearchInput
            placeholder={t`Search fields and functions`}
            value={helperSearch}
            onChange={setHelperSearch}
          />
          {filteredFields.length > 0 && (
            <>
              <StyledHelperHeading>{t`Attributes`}</StyledHelperHeading>
              {filteredFields.map((field) => (
                <StyledHelperButton
                  key={field.id}
                  type="button"
                  onClick={() => insertSource(`{${field.label}}`)}
                >
                  <span>{field.label}</span>
                  <StyledFunctionSignature>
                    {field.type === FieldMetadataType.RELATION
                      ? t`Relation`
                      : t`Number`}
                  </StyledFunctionSignature>
                </StyledHelperButton>
              ))}
            </>
          )}
          {filteredFunctions.length > 0 && (
            <>
              <StyledHelperHeading>{t`Functions`}</StyledHelperHeading>
              {filteredFunctions.map(({ name, signature }) => (
                <StyledHelperButton
                  key={name}
                  type="button"
                  onClick={() => insertSource(`${name}()`, -1)}
                >
                  <span>{name}</span>
                  <StyledFunctionSignature>{signature}</StyledFunctionSignature>
                </StyledHelperButton>
              ))}
            </>
          )}
        </StyledHelper>
      </StyledEditorLayout>
      <StyledPreview>
        <Select<string>
          dropdownId="formula-preview-record"
          fullWidth
          withSearchInput
          label={t`Preview record`}
          value={selectedRecordId}
          onChange={setSelectedRecordId}
          emptyOption={{ label: t`Select a record`, value: '' }}
          options={previewRecords.map((record) => ({
            label: record.name,
            value: record.id,
          }))}
          disabled={recordsLoading}
        />
        <Button
          title={t`Preview`}
          Icon={IconPlayerPlay}
          variant="secondary"
          size="small"
          onClick={handlePreview}
          disabled={
            isPreviewing ||
            selectedRecordId === '' ||
            compileResult.status !== 'success'
          }
        />
      </StyledPreview>
      {(previewResult !== null || previewError !== null) && (
        <StyledPreviewResult aria-live="polite">
          <span>{t`Result`}</span>
          <strong>
            {previewError ??
              (previewResult?.value === null
                ? t`Empty`
                : previewResult?.value.toLocaleString())}
          </strong>
        </StyledPreviewResult>
      )}
    </Section>
  );
};
