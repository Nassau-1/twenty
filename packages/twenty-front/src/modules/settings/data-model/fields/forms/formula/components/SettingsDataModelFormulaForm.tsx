import { type FieldMetadataItem } from '@/object-metadata/types/FieldMetadataItem';
import { SettingsTextInput } from '@/ui/input/components/SettingsTextInput';
import { Select } from '@/ui/input/components/Select';
import { TextArea } from '@/ui/input/components/TextArea';
import { styled } from '@linaria/react';
import { useLingui } from '@lingui/react/macro';
import { H2Title } from 'twenty-ui/typography';
import { Section } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledInputs = styled.div`
  display: grid;
  gap: ${themeCssVariables.spacing[4]};
  grid-template-columns: minmax(0, 1fr) minmax(120px, 0.35fr);
  width: 100%;

  @media (max-width: 480px) {
    grid-template-columns: minmax(0, 1fr);
  }
`;

const StyledError = styled.div`
  color: ${themeCssVariables.color.red};
  font-size: ${themeCssVariables.font.size.sm};
  margin-top: ${themeCssVariables.spacing[2]};
`;

type SettingsDataModelFormulaFormProps = {
  sourceFields: FieldMetadataItem[];
  selectedFieldId: string;
  onSelectedFieldIdChange: (fieldMetadataId: string) => void;
  calculationType: FormulaCalculationType;
  onCalculationTypeChange: (calculationType: FormulaCalculationType) => void;
  multiplierLiteral: string;
  onMultiplierLiteralChange: (value: string) => void;
  formulaPreview: string;
  validationError: string | null;
};

export type FormulaCalculationType =
  | 'COUNT_RELATED_RECORDS'
  | 'MULTIPLY_NUMBER';

export const SettingsDataModelFormulaForm = ({
  sourceFields,
  selectedFieldId,
  onSelectedFieldIdChange,
  calculationType,
  onCalculationTypeChange,
  multiplierLiteral,
  onMultiplierLiteralChange,
  formulaPreview,
  validationError,
}: SettingsDataModelFormulaFormProps) => {
  const { t } = useLingui();

  return (
    <Section>
      <H2Title title={t`Formula`} description={t`Calculation`} />
      <StyledInputs>
        <Select<FormulaCalculationType>
          dropdownId="formula-calculation-type"
          fullWidth
          label={t`Calculation`}
          value={calculationType}
          onChange={onCalculationTypeChange}
          options={[
            {
              label: t`Count related records`,
              value: 'COUNT_RELATED_RECORDS',
            },
            { label: t`Multiply a number`, value: 'MULTIPLY_NUMBER' },
          ]}
        />
        <Select<string>
          dropdownId="formula-source-field"
          fullWidth
          withSearchInput
          label={
            calculationType === 'COUNT_RELATED_RECORDS'
              ? t`Relation field`
              : t`Source number field`
          }
          value={selectedFieldId}
          onChange={onSelectedFieldIdChange}
          options={sourceFields.map((field) => ({
            label: field.label,
            value: field.id,
          }))}
        />
        {calculationType === 'MULTIPLY_NUMBER' && (
          <SettingsTextInput
            instanceId="formula-multiplier"
            label={t`Multiplier`}
            value={multiplierLiteral}
            onChange={onMultiplierLiteralChange}
          />
        )}
      </StyledInputs>
      <TextArea
        textAreaId="formula-preview"
        label={t`Formula preview`}
        value={formulaPreview}
        minRows={2}
        readOnly
      />
      {validationError !== null && (
        <StyledError role="alert">{validationError}</StyledError>
      )}
    </Section>
  );
};
