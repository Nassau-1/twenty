import { isDDLLockedState } from '@/client-config/states/isDDLLockedState';
import { useFieldMetadataItem } from '@/object-metadata/hooks/useFieldMetadataItem';
import { useFilteredObjectMetadataItems } from '@/object-metadata/hooks/useFilteredObjectMetadataItems';
import { SettingsPageContainer } from '@/settings/components/SettingsPageContainer';
import { SettingsWizardStepBar } from '@/settings/components/layout/SettingsWizardStepBar';
import { FIELD_NAME_MAXIMUM_LENGTH } from '@/settings/data-model/constants/FieldNameMaximumLength';
import { FORMULA_FIELD_TYPE } from '@/settings/data-model/constants/FormulaFieldType';
import { SettingsObjectNewFieldHeaderIcon } from '@/settings/data-model/fields/components/SettingsObjectNewFieldHeaderIcon';
import { SettingsDataModelFieldIconLabelForm } from '@/settings/data-model/fields/forms/components/SettingsDataModelFieldIconLabelForm';
import { SettingsDataModelFieldSettingsFormCard } from '@/settings/data-model/fields/forms/components/SettingsDataModelFieldSettingsFormCard';
import { SettingsDataModelFormulaForm } from '@/settings/data-model/fields/forms/formula/components/SettingsDataModelFormulaForm';
import {
  createFormulaMetadata,
  planFormulaMetadata,
} from '@/settings/data-model/fields/forms/formula/services/formulaMetadataApi';
import { compileFormulaDisplaySource } from '@/settings/data-model/fields/forms/formula/utils/compileFormulaDisplaySource';
import {
  getFieldMetadataTypeFromFormulaOutputType,
  getFormulaOutputFieldFormDefaults,
} from '@/settings/data-model/fields/forms/formula/utils/formulaFieldTypeMappings';
import { settingsFieldFormSchema } from '@/settings/data-model/fields/forms/validation-schemas/settingsFieldFormSchema';
import { useSnackBar } from '@/ui/feedback/snack-bar-manager/hooks/useSnackBar';
import { SettingsPageLayout } from '@/settings/components/layout/SettingsPageLayout';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { zodResolver } from '@hookform/resolvers/zod';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useMemo, useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  AppPath,
  type RelationCreationPayload,
  SettingsPath,
} from 'twenty-shared/types';
import { getSettingsPath, isDefined } from 'twenty-shared/utils';
import { H2Title } from 'twenty-ui/typography';
import { Button } from 'twenty-ui/input';
import { Section } from 'twenty-ui/layout';
import { themeCssVariables } from 'twenty-ui/theme-constants';
import { type z } from 'zod';
import { FieldMetadataType } from '~/generated-metadata/graphql';
import { useNavigateApp } from '~/hooks/useNavigateApp';
import { useNavigateSettings } from '~/hooks/useNavigateSettings';
import { DEFAULT_ICONS_BY_FIELD_TYPE } from '~/pages/settings/data-model/constants/DefaultIconsByFieldType';

type SettingsDataModelNewFieldFormValues = z.infer<
  ReturnType<typeof settingsFieldFormSchema>
> &
  any;

const DEFAULT_ICON_FOR_NEW_FIELD = 'IconUsers';

export const SettingsObjectNewFieldConfigure = () => {
  const { t } = useLingui();

  const navigateApp = useNavigateApp();
  const navigate = useNavigateSettings();

  const { objectNamePlural = '' } = useParams();
  const [searchParams] = useSearchParams();
  const fieldTypeSearchParam = searchParams.get('fieldType');
  const isFormulaField = fieldTypeSearchParam === FORMULA_FIELD_TYPE;
  const fieldType = isFormulaField
    ? FieldMetadataType.NUMBER
    : ((fieldTypeSearchParam as FieldMetadataType) ?? FieldMetadataType.TEXT);
  const { enqueueErrorSnackBar, enqueueSuccessSnackBar } = useSnackBar();

  const { findObjectMetadataItemByNamePlural } =
    useFilteredObjectMetadataItems();
  const activeObjectMetadataItem =
    findObjectMetadataItemByNamePlural(objectNamePlural);
  const { createMetadataField, deleteMetadataField } = useFieldMetadataItem();

  const formConfig = useForm<SettingsDataModelNewFieldFormValues>({
    mode: 'onTouched',
    resolver: zodResolver(
      settingsFieldFormSchema({
        existingOtherLabels: activeObjectMetadataItem?.fields.map(
          (value) => value.name,
        ),
        sourceObjectMetadataId: activeObjectMetadataItem?.id,
      }),
    ),
    defaultValues: {
      type: fieldType,
      icon:
        DEFAULT_ICONS_BY_FIELD_TYPE[fieldType] ?? DEFAULT_ICON_FOR_NEW_FIELD,
      label: '',
      name: '',
    },
  });

  useEffect(() => {
    formConfig.setValue(
      'icon',
      DEFAULT_ICONS_BY_FIELD_TYPE[fieldType] ?? DEFAULT_ICON_FOR_NEW_FIELD,
    );
  }, [fieldType, formConfig]);

  const [isSaving, setIsSaving] = useState(false);
  const [formulaSource, setFormulaSource] = useState('');
  const [hasInitializedFormulaSource, setHasInitializedFormulaSource] =
    useState(false);

  useEffect(() => {
    if (!isDefined(activeObjectMetadataItem)) {
      navigateApp(AppPath.NotFound);
    }
  }, [activeObjectMetadataItem, navigateApp]);

  const formulaSourceFields = useMemo(
    () =>
      activeObjectMetadataItem?.fields.filter(
        (field) =>
          (field.type === FieldMetadataType.NUMBER ||
            field.type === FieldMetadataType.TEXT ||
            field.type === FieldMetadataType.BOOLEAN ||
            field.type === FieldMetadataType.RELATION) &&
          field.isActive !== false &&
          field.isUIEditable !== false,
      ) ?? [],
    [activeObjectMetadataItem?.fields],
  );

  useEffect(() => {
    if (
      !isFormulaField ||
      hasInitializedFormulaSource ||
      formulaSourceFields.length === 0
    ) {
      return;
    }

    const relationField = formulaSourceFields.find(
      (field) => field.type === FieldMetadataType.RELATION,
    );
    const initialField = relationField ?? formulaSourceFields[0];

    setFormulaSource(
      relationField !== undefined
        ? `count({${relationField.label}})`
        : initialField.type === FieldMetadataType.NUMBER
          ? `{${initialField.label}} * 2`
          : initialField.type === FieldMetadataType.TEXT
            ? `trim({${initialField.label}})`
            : `{${initialField.label}}`,
    );
    setHasInitializedFormulaSource(true);
  }, [formulaSourceFields, hasInitializedFormulaSource, isFormulaField]);

  const isDDLLocked = useAtomStateValue(isDDLLockedState);

  const formulaCompileResult = compileFormulaDisplaySource({
    displaySource: formulaSource,
    sourceFields: formulaSourceFields,
  });
  const formulaOutputFieldType =
    formulaCompileResult.status === 'success'
      ? getFieldMetadataTypeFromFormulaOutputType(
          formulaCompileResult.compiledFormula.output.type,
        )
      : FieldMetadataType.NUMBER;

  useEffect(() => {
    if (!isFormulaField || formulaCompileResult.status !== 'success') {
      return;
    }

    if (formConfig.getValues('type') === formulaOutputFieldType) {
      formConfig.setValue('type', formulaOutputFieldType, {
        shouldValidate: true,
      });
      return;
    }

    const outputDefaults =
      getFormulaOutputFieldFormDefaults(formulaOutputFieldType);

    Object.entries(outputDefaults).forEach(([key, value]) => {
      formConfig.setValue(key, value, { shouldDirty: true });
    });
    void formConfig.trigger();
  }, [
    formConfig,
    formulaCompileResult.status,
    formulaOutputFieldType,
    isFormulaField,
  ]);

  if (!isDefined(activeObjectMetadataItem)) return null;

  const { isValid, isSubmitting } = formConfig.formState;

  const canSave =
    isValid &&
    !isSubmitting &&
    !isDDLLocked &&
    (!isFormulaField || formulaCompileResult.status === 'success');

  const handleSave = async (
    formValues: SettingsDataModelNewFieldFormValues,
  ) => {
    setIsSaving(true);

    const createCleanUp = (
      creationResult: Awaited<ReturnType<typeof createMetadataField>>,
    ) => {
      if (creationResult.status === 'successful') {
        navigate(SettingsPath.ObjectDetail, {
          objectNamePlural,
        });
      }
      setIsSaving(false);
    };

    if (isFormulaField) {
      if (formulaCompileResult.status !== 'success') {
        setIsSaving(false);
        return;
      }

      const hasRelationDependency =
        formulaCompileResult.compiledFormula.dependencies.some(
          (dependency) => dependency.kind === 'RELATION',
        );

      const outputFieldCreation = await createMetadataField({
        ...formValues,
        type: formulaOutputFieldType,
        objectMetadataId: activeObjectMetadataItem.id,
        isUIEditable: false,
        isNullable:
          hasRelationDependency ||
          formulaCompileResult.compiledFormula.output.nullable,
      });

      if (outputFieldCreation.status !== 'successful') {
        setIsSaving(false);
        return;
      }

      const outputFieldMetadataId =
        outputFieldCreation.response.data?.createOneField.id;

      if (!isDefined(outputFieldMetadataId)) {
        setIsSaving(false);
        enqueueErrorSnackBar({ message: t`Formula could not be created.` });
        return;
      }

      const formulaInput = {
        objectMetadataId: activeObjectMetadataItem.id,
        outputFieldMetadataId,
        document: formulaCompileResult.document,
        reason: 'Created from the native Data Model Formula editor.',
      };

      try {
        await planFormulaMetadata(formulaInput);
        await createFormulaMetadata(formulaInput);
        enqueueSuccessSnackBar({ message: t`Formula created` });
        navigate(SettingsPath.ObjectDetail, { objectNamePlural });
      } catch (error) {
        await deleteMetadataField({ idToDelete: outputFieldMetadataId });
        enqueueErrorSnackBar({
          message:
            error instanceof Error
              ? error.message
              : t`Formula could not be created.`,
        });
      } finally {
        setIsSaving(false);
      }

      return;
    }

    if (formValues.type !== FieldMetadataType.MORPH_RELATION) {
      const creationResult = await createMetadataField({
        ...formValues,
        objectMetadataId: activeObjectMetadataItem.id,
      });

      return createCleanUp(creationResult);
    }

    const {
      morphRelationObjectMetadataIds,
      targetFieldLabel,
      iconOnDestination,
      relationType,
    } = formValues;

    switch (true) {
      case morphRelationObjectMetadataIds.length > 1: {
        const creationResult = await createMetadataField({
          ...formValues,
          type: FieldMetadataType.MORPH_RELATION,
          objectMetadataId: activeObjectMetadataItem.id,
          isLabelSyncedWithName: false,
          morphRelationsCreationPayload: morphRelationObjectMetadataIds.map(
            (morphRelationObjectMetadataId: string) => ({
              type: relationType,
              targetObjectMetadataId: morphRelationObjectMetadataId,
              targetFieldLabel,
              targetFieldIcon: iconOnDestination,
            }),
          ),
        });
        return createCleanUp(creationResult);
      }
      case morphRelationObjectMetadataIds.length === 1: {
        const relationCreationPayload = {
          type: relationType,
          targetObjectMetadataId: morphRelationObjectMetadataIds[0],
          targetFieldLabel,
          targetFieldIcon: iconOnDestination,
        } satisfies RelationCreationPayload;

        const creationResult = await createMetadataField({
          ...formValues,
          type: FieldMetadataType.RELATION,
          objectMetadataId: activeObjectMetadataItem.id,
          relationCreationPayload,
        });

        return createCleanUp(creationResult);
      }
      default: {
        enqueueErrorSnackBar({
          message: t`Please select at least one destination object for this relation.`,
        });
        return setIsSaving(false);
      }
    }
  };

  if (!isDefined(activeObjectMetadataItem)) return null;

  return (
    <FormProvider // oxlint-disable-next-line react/jsx-props-no-spreading
      {...formConfig}
    >
      <SettingsPageLayout
        title={activeObjectMetadataItem.labelPlural}
        icon={
          <SettingsObjectNewFieldHeaderIcon
            objectMetadataItem={activeObjectMetadataItem}
          />
        }
        titleColor={themeCssVariables.font.color.tertiary}
        links={[
          {
            children: t`Workspace`,
            href: getSettingsPath(SettingsPath.General),
          },
          {
            children: t`Objects`,
            href: getSettingsPath(SettingsPath.Objects),
          },
          {
            children: activeObjectMetadataItem.labelPlural,
            href: getSettingsPath(SettingsPath.ObjectDetail, {
              objectNamePlural,
            }),
          },
          { children: isFormulaField ? t`New formula` : t`New field` },
        ]}
        secondaryBar={
          <SettingsWizardStepBar
            label={
              isFormulaField ? t`2. Configure formula` : t`2. Configure field`
            }
            onBack={() =>
              navigate(
                SettingsPath.ObjectNewFieldSelect,
                { objectNamePlural },
                {
                  fieldType: isFormulaField ? FORMULA_FIELD_TYPE : fieldType,
                },
              )
            }
            trailing={
              <Button
                title={t`Save`}
                variant="primary"
                size="small"
                accent="blue"
                onClick={formConfig.handleSubmit(handleSave)}
                disabled={!canSave || isSaving}
              />
            }
          />
        }
      >
        <SettingsPageContainer>
          <Section>
            <H2Title
              title={t`Icon and Name`}
              description={t`The name and icon of this field`}
            />
            <SettingsDataModelFieldIconLabelForm
              maxLength={FIELD_NAME_MAXIMUM_LENGTH}
              isCreationMode={true}
            />
          </Section>
          {isFormulaField && (
            <SettingsDataModelFormulaForm
              sourceFields={formulaSourceFields}
              formulaSource={formulaSource}
              onFormulaSourceChange={setFormulaSource}
              compileResult={formulaCompileResult}
              objectMetadataId={activeObjectMetadataItem.id}
              objectNameSingular={activeObjectMetadataItem.nameSingular}
            />
          )}
          <Section>
            <H2Title
              title={isFormulaField ? t`Output formatting` : t`Customization`}
              description={
                isFormulaField
                  ? t`Formatting for the calculated value`
                  : t`Customize field settings`
              }
            />
            <SettingsDataModelFieldSettingsFormCard
              fieldType={isFormulaField ? formulaOutputFieldType : fieldType}
              existingFieldMetadataId=""
              objectNameSingular={activeObjectMetadataItem.nameSingular}
            />
          </Section>
        </SettingsPageContainer>
      </SettingsPageLayout>
    </FormProvider>
  );
};
