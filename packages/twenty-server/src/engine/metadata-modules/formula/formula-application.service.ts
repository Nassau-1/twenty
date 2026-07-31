import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  compileFormulaEditorDocument,
  type CompiledFormula,
  evaluateCompiledFormula,
  FORMULA_SECURITY_LIMITS,
  type FormulaEditorDocument,
  type FormulaHistoricalFunctionName,
  type FormulaHistoricalValueResolution,
  type FormulaNode,
  type FormulaValue,
} from 'twenty-shared/formula';
import { FieldMetadataType } from 'twenty-shared/types';
import { type FindOptionsWhere, type ObjectLiteral, Repository } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaAuthorizationService } from 'src/engine/metadata-modules/formula/formula-authorization.service';
import {
  type FormulaDependencyPlan,
  FormulaDependencyPlannerService,
} from 'src/engine/metadata-modules/formula/formula-dependency-planner.service';
import {
  FormulaHistoryService,
  type FormulaHistoryLookupResult,
} from 'src/engine/metadata-modules/formula/formula-history.service';
import { FormulaMetadataService } from 'src/engine/metadata-modules/formula/formula-metadata.service';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { type WorkspaceEntityManager } from 'src/engine/twenty-orm/entity-manager/workspace-entity-manager';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

type FormulaRecord = ObjectLiteral & {
  id: string;
  updatedAt?: Date | string;
};

type CreateFormulaArgs = {
  workspaceId: string;
  objectMetadataId: string;
  outputFieldMetadataId: string;
  document: FormulaEditorDocument;
  reason: string | null;
};

type RecomputeFormulaArgs = {
  workspaceId: string;
  formulaDefinitionId: string;
  recordId: string;
};

type PreviewFormulaArgs = {
  workspaceId: string;
  objectMetadataId: string;
  recordId: string;
  document: FormulaEditorDocument;
};

type FormulaPreviewResult = {
  recordId: string;
  output: CompiledFormula['output'];
  value: number | null;
  evaluatorVersion: string;
  instructionCount: number;
};

type FormulaRecomputeResult = {
  formulaDefinitionId: string;
  formulaVersionId: string;
  recordId: string;
  outputFieldName: string;
  value: number | null;
  evaluatorVersion: string;
  instructionCount: number;
  historyReceiptId: string;
  historyAppended: boolean;
};

type HistoricalLookup = {
  functionName: FormulaHistoricalFunctionName;
  fieldMetadataUniversalIdentifier: string;
  at?: string;
};

const historicalLookupKey = ({
  functionName,
  fieldMetadataUniversalIdentifier,
  at,
}: HistoricalLookup): string =>
  `${functionName}:${fieldMetadataUniversalIdentifier}:${at ?? ''}`;

const collectHistoricalLookups = (root: FormulaNode): HistoricalLookup[] => {
  const lookups: HistoricalLookup[] = [];
  const visit = (node: FormulaNode): void => {
    if (
      node.kind === 'CALL' &&
      (node.functionName === 'previousValue' || node.functionName === 'valueAt')
    ) {
      const referenceNode = node.arguments[0];
      const atNode = node.arguments[1];

      if (
        referenceNode.kind === 'REFERENCE' &&
        referenceNode.reference.kind === 'FIELD'
      ) {
        lookups.push({
          functionName: node.functionName,
          fieldMetadataUniversalIdentifier:
            referenceNode.reference.fieldMetadataUniversalIdentifier,
          at:
            node.functionName === 'valueAt' &&
            atNode?.kind === 'LITERAL' &&
            atNode.value.type === 'TEXT'
              ? atNode.value.value
              : undefined,
        });
      }
    }

    switch (node.kind) {
      case 'BINARY':
        visit(node.left);
        visit(node.right);
        break;
      case 'CALL':
        node.arguments.forEach(visit);
        break;
      case 'UNARY':
        visit(node.operand);
        break;
      case 'LITERAL':
      case 'REFERENCE':
        break;
    }
  };

  visit(root);

  return [
    ...new Map(
      lookups.map((lookup) => [historicalLookupKey(lookup), lookup]),
    ).values(),
  ];
};

const toHistoricalResolution = (
  result: FormulaHistoryLookupResult,
): FormulaHistoricalValueResolution =>
  result.status === 'available'
    ? { status: 'available', value: result.value }
    : { status: 'unavailable' };

const relationCountMapsAreEqual = (
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): boolean =>
  left.size === right.size &&
  [...left].every(([key, value]) => right.get(key) === value);

class FormulaRelationLimitExceededException extends BadRequestException {}

@Injectable()
export class FormulaApplicationService {
  constructor(
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
    @InjectRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    private readonly formulaDependencyPlannerService: FormulaDependencyPlannerService,
    private readonly formulaAuthorizationService: FormulaAuthorizationService,
    private readonly formulaMetadataService: FormulaMetadataService,
    private readonly formulaHistoryService: FormulaHistoryService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  async createFormula({
    workspaceId,
    objectMetadataId,
    outputFieldMetadataId,
    document,
    reason,
  }: CreateFormulaArgs): Promise<FormulaDefinitionEntity> {
    const { compiledFormula } = await this.prepareFormula({
      workspaceId,
      objectMetadataId,
      outputFieldMetadataId,
      document,
      reason,
    });

    return this.formulaMetadataService.createDefinitionWithActiveVersion({
      workspaceId,
      objectMetadataId,
      outputFieldMetadataId,
      editorDocument: document,
      compiledFormula,
      createdByWorkspaceMemberId: null,
      reason,
    });
  }

  async planFormula(input: CreateFormulaArgs): Promise<FormulaDependencyPlan> {
    const { dependencyPlan } = await this.prepareFormula(input);

    return dependencyPlan;
  }

  async previewFormula({
    workspaceId,
    objectMetadataId,
    recordId,
    document,
  }: PreviewFormulaArgs): Promise<FormulaPreviewResult> {
    if (
      document.references.length >
      FORMULA_SECURITY_LIMITS.maxDependenciesPerFormula
    ) {
      throw new BadRequestException(
        `A Formula cannot have more than ${FORMULA_SECURITY_LIMITS.maxDependenciesPerFormula} dependencies.`,
      );
    }

    const relationDependencyCount = new Set(
      document.references.flatMap((reference) =>
        reference.kind === 'RELATION'
          ? [reference.relationFieldMetadataUniversalIdentifier]
          : [],
      ),
    ).size;

    if (
      relationDependencyCount >
      FORMULA_SECURITY_LIMITS.maxRelationDependenciesPerFormula
    ) {
      throw new BadRequestException(
        `A Formula cannot have more than ${FORMULA_SECURITY_LIMITS.maxRelationDependenciesPerFormula} relation dependencies.`,
      );
    }

    const [objectMetadata, fields] = await Promise.all([
      this.objectMetadataRepository.findOne({
        where: { id: objectMetadataId, workspaceId },
      }),
      this.fieldMetadataRepository.find({
        where: { objectMetadataId, workspaceId },
      }),
    ]);

    if (objectMetadata === null) {
      throw new NotFoundException('Formula object metadata was not found.');
    }

    const fieldsByUniversalIdentifier = new Map(
      fields.map((field) => [field.universalIdentifier, field]),
    );

    for (const reference of document.references) {
      if (reference.kind === 'RELATION') {
        const relationField = fieldsByUniversalIdentifier.get(
          reference.relationFieldMetadataUniversalIdentifier,
        );

        if (
          relationField === undefined ||
          relationField.type !== FieldMetadataType.RELATION ||
          relationField.relationTargetObjectMetadataId === null ||
          relationField.relationTargetObjectMetadataId === undefined
        ) {
          throw new BadRequestException(
            'Every Formula relation must resolve inside the selected object.',
          );
        }

        continue;
      }

      if (reference.kind !== 'FIELD') {
        throw new BadRequestException(
          'The current Formula slice supports direct field and relation references only.',
        );
      }

      const field = fieldsByUniversalIdentifier.get(
        reference.fieldMetadataUniversalIdentifier,
      );

      if (field === undefined || field.type !== FieldMetadataType.NUMBER) {
        throw new BadRequestException(
          'Formula preview supports NUMBER source fields only.',
        );
      }
    }

    const compileResult = compileFormulaEditorDocument({
      document,
      resolveReference: (reference) => {
        if (reference.kind === 'RELATION') {
          const relationField = fieldsByUniversalIdentifier.get(
            reference.relationFieldMetadataUniversalIdentifier,
          );

          return relationField?.type === FieldMetadataType.RELATION &&
            relationField.relationTargetObjectMetadataId !== null &&
            relationField.relationTargetObjectMetadataId !== undefined
            ? {
                status: 'success',
                type: 'RELATION',
                nullable: false,
              }
            : { status: 'error', reason: 'NOT_FOUND' };
        }

        if (reference.kind !== 'FIELD') {
          return { status: 'error', reason: 'NOT_FOUND' };
        }

        const field = fieldsByUniversalIdentifier.get(
          reference.fieldMetadataUniversalIdentifier,
        );

        return field?.type === FieldMetadataType.NUMBER
          ? {
              status: 'success',
              type: 'NUMBER',
              nullable: field.isNullable !== false,
            }
          : { status: 'error', reason: 'NOT_FOUND' };
      },
    });

    if (compileResult.status === 'error') {
      throw new BadRequestException({
        message: 'Formula compilation failed.',
        diagnostics: compileResult.diagnostics,
      });
    }

    if (compileResult.compiledFormula.output.type !== 'NUMBER') {
      throw new BadRequestException(
        'Formula preview requires a NUMBER result.',
      );
    }

    const dependencyFields = compileResult.compiledFormula.dependencies.flatMap(
      (dependency) => {
        const universalIdentifier =
          dependency.kind === 'FIELD'
            ? dependency.fieldMetadataUniversalIdentifier
            : dependency.kind === 'RELATION'
              ? dependency.relationFieldMetadataUniversalIdentifier
              : null;
        const field =
          universalIdentifier === null
            ? undefined
            : fieldsByUniversalIdentifier.get(universalIdentifier);

        return field === undefined ? [] : [field];
      },
    );

    await this.formulaAuthorizationService.assertCanReadDependencies({
      workspaceId,
      objectMetadataId,
      dependencyFieldMetadataIds: [
        ...new Set(dependencyFields.map(({ id }) => id)),
      ],
      dependencyObjectMetadataIds: [
        ...new Set(
          dependencyFields.flatMap(({ relationTargetObjectMetadataId }) =>
            relationTargetObjectMetadataId === null ||
            relationTargetObjectMetadataId === undefined
              ? []
              : [relationTargetObjectMetadataId],
          ),
        ),
      ],
    });

    const compiledFormula = compileResult.compiledFormula;
    const relationDependencies = compiledFormula.dependencies.filter(
      (dependency) => dependency.kind === 'RELATION',
    );
    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository =
          await this.globalWorkspaceOrmManager.getRepository<FormulaRecord>(
            workspaceId,
            objectMetadata.nameSingular,
            { shouldBypassPermissionChecks: true },
          );
        const record = await repository.findOne({
          where: { id: recordId } as FindOptionsWhere<FormulaRecord>,
        });

        if (record === null) {
          throw new NotFoundException('Formula preview record was not found.');
        }

        const relationCounts = new Map<string, number>();

        for (const dependency of relationDependencies) {
          const relationField = fieldsByUniversalIdentifier.get(
            dependency.relationFieldMetadataUniversalIdentifier,
          );

          if (
            relationField === undefined ||
            relationField.type !== FieldMetadataType.RELATION
          ) {
            throw new BadRequestException(
              'Formula relation metadata could not be resolved.',
            );
          }

          const countResult = await repository
            .createQueryBuilder('formulaRecord')
            .leftJoin(
              `formulaRecord.${relationField.name}`,
              'formulaRelatedRecord',
            )
            .select('COUNT(DISTINCT formulaRelatedRecord.id)', 'count')
            .where('formulaRecord.id = :recordId', { recordId })
            .getRawOne<{ count: string | number }>();
          const count = Number(countResult?.count ?? 0);

          if (!Number.isSafeInteger(count) || count < 0) {
            throw new BadRequestException(
              'Formula relation count could not be resolved safely.',
            );
          }

          if (count > FORMULA_SECURITY_LIMITS.maxRelationRecordsPerEvaluation) {
            throw new BadRequestException(
              `Formula relation count exceeds the ${FORMULA_SECURITY_LIMITS.maxRelationRecordsPerEvaluation} record limit.`,
            );
          }

          relationCounts.set(
            dependency.relationFieldMetadataUniversalIdentifier,
            count,
          );
        }

        const historicalResolutions = new Map<
          string,
          FormulaHistoricalValueResolution
        >();

        await Promise.all(
          collectHistoricalLookups(compiledFormula.ast.root).map(
            async (lookup) => {
              const field = fieldsByUniversalIdentifier.get(
                lookup.fieldMetadataUniversalIdentifier,
              );

              if (field === undefined) {
                historicalResolutions.set(historicalLookupKey(lookup), {
                  status: 'unavailable',
                });
                return;
              }

              let result: FormulaHistoryLookupResult;

              if (lookup.functionName === 'previousValue') {
                result = await this.formulaHistoryService.previousValue({
                  workspaceId,
                  objectMetadataId,
                  recordId,
                  fieldMetadataId: field.id,
                });
              } else {
                const at = new Date(lookup.at ?? '');

                if (Number.isNaN(at.getTime())) {
                  throw new BadRequestException(
                    'valueAt requires a valid ISO timestamp.',
                  );
                }

                result = await this.formulaHistoryService.valueAt(
                  {
                    workspaceId,
                    objectMetadataId,
                    recordId,
                    fieldMetadataId: field.id,
                  },
                  at,
                );
              }

              historicalResolutions.set(
                historicalLookupKey(lookup),
                toHistoricalResolution(result),
              );
            },
          ),
        );

        const evaluation = evaluateCompiledFormula({
          compiledFormula,
          resolveValue: (reference): FormulaValue | undefined => {
            if (reference.kind === 'RELATION') {
              const count = relationCounts.get(
                reference.relationFieldMetadataUniversalIdentifier,
              );

              return count === undefined
                ? undefined
                : { type: 'RELATION', value: count };
            }

            if (reference.kind !== 'FIELD') {
              return undefined;
            }

            const field = fieldsByUniversalIdentifier.get(
              reference.fieldMetadataUniversalIdentifier,
            );
            const rawValue =
              field === undefined ? undefined : record[field.name];

            if (rawValue === null || rawValue === undefined) {
              return { type: 'NULL', value: null };
            }

            return typeof rawValue === 'number' && Number.isFinite(rawValue)
              ? { type: 'NUMBER', value: rawValue }
              : undefined;
          },
          resolveHistoricalValue: (request) => {
            if (request.reference.kind !== 'FIELD') {
              return { status: 'unavailable' };
            }

            return (
              historicalResolutions.get(
                historicalLookupKey({
                  functionName: request.functionName,
                  fieldMetadataUniversalIdentifier:
                    request.reference.fieldMetadataUniversalIdentifier,
                  at: request.at,
                }),
              ) ?? { status: 'unavailable' }
            );
          },
          limits: {
            maxRelationItems:
              FORMULA_SECURITY_LIMITS.maxRelationRecordsPerEvaluation,
          },
        });

        if (evaluation.status === 'error') {
          throw new BadRequestException({
            message: 'Formula preview failed.',
            diagnostics: evaluation.diagnostics,
          });
        }

        if (
          evaluation.value.type !== 'NUMBER' &&
          evaluation.value.type !== 'NULL'
        ) {
          throw new BadRequestException(
            'Formula preview result does not match a NUMBER output.',
          );
        }

        return {
          recordId,
          output: compiledFormula.output,
          value:
            evaluation.value.type === 'NULL' ? null : evaluation.value.value,
          evaluatorVersion: evaluation.evaluatorVersion,
          instructionCount: evaluation.instructionCount,
        };
      },
      authContext,
    );
  }

  private async prepareFormula({
    workspaceId,
    objectMetadataId,
    outputFieldMetadataId,
    document,
  }: CreateFormulaArgs): Promise<{
    compiledFormula: CompiledFormula;
    dependencyPlan: FormulaDependencyPlan;
  }> {
    if (
      document.references.length >
      FORMULA_SECURITY_LIMITS.maxDependenciesPerFormula
    ) {
      throw new BadRequestException(
        `A Formula cannot have more than ${FORMULA_SECURITY_LIMITS.maxDependenciesPerFormula} dependencies.`,
      );
    }
    const relationDependencyCount = new Set(
      document.references.flatMap((reference) =>
        reference.kind === 'RELATION'
          ? [reference.relationFieldMetadataUniversalIdentifier]
          : [],
      ),
    ).size;

    if (
      relationDependencyCount >
      FORMULA_SECURITY_LIMITS.maxRelationDependenciesPerFormula
    ) {
      throw new BadRequestException(
        `A Formula cannot have more than ${FORMULA_SECURITY_LIMITS.maxRelationDependenciesPerFormula} relation dependencies.`,
      );
    }

    const [objectMetadata, fields, objectFormulaCount, workspaceFormulaCount] =
      await Promise.all([
        this.objectMetadataRepository.findOne({
          where: { id: objectMetadataId, workspaceId },
        }),
        this.fieldMetadataRepository.find({
          where: { objectMetadataId, workspaceId },
        }),
        this.formulaMetadataService.countDefinitions({
          workspaceId,
          objectMetadataId,
        }),
        this.formulaMetadataService.countDefinitions({ workspaceId }),
      ]);

    if (objectMetadata === null) {
      throw new NotFoundException('Formula object metadata was not found.');
    }
    if (objectFormulaCount >= FORMULA_SECURITY_LIMITS.maxDefinitionsPerObject) {
      throw new BadRequestException(
        `An object cannot have more than ${FORMULA_SECURITY_LIMITS.maxDefinitionsPerObject} Formulas.`,
      );
    }
    if (
      workspaceFormulaCount >=
      FORMULA_SECURITY_LIMITS.maxDefinitionsPerWorkspace
    ) {
      throw new BadRequestException(
        `A workspace cannot have more than ${FORMULA_SECURITY_LIMITS.maxDefinitionsPerWorkspace} Formulas.`,
      );
    }

    const outputField = fields.find(({ id }) => id === outputFieldMetadataId);

    if (outputField === undefined) {
      throw new NotFoundException('Formula output field was not found.');
    }
    if (outputField.type !== FieldMetadataType.NUMBER) {
      throw new BadRequestException(
        'The first Formula slice requires a NUMBER output field.',
      );
    }
    if (outputField.isUIEditable !== false) {
      throw new BadRequestException(
        'Formula output fields must be created with isUIEditable=false.',
      );
    }
    if (relationDependencyCount > 0 && outputField.isNullable !== true) {
      throw new BadRequestException(
        'Relation Formula output fields must be nullable so failed materializations cannot expose stale values.',
      );
    }

    const fieldsByUniversalIdentifier = new Map(
      fields.map((field) => [field.universalIdentifier, field]),
    );

    for (const reference of document.references) {
      if (reference.kind === 'RELATION') {
        const relationField = fieldsByUniversalIdentifier.get(
          reference.relationFieldMetadataUniversalIdentifier,
        );

        if (
          relationField === undefined ||
          relationField.type !== FieldMetadataType.RELATION ||
          relationField.relationTargetObjectMetadataId === null ||
          relationField.relationTargetObjectMetadataId === undefined
        ) {
          throw new BadRequestException(
            'Every Formula relation must resolve inside the selected object.',
          );
        }
        continue;
      }
      if (reference.kind !== 'FIELD') {
        throw new BadRequestException(
          'The current Formula slice supports direct field and relation references only.',
        );
      }

      const field = fieldsByUniversalIdentifier.get(
        reference.fieldMetadataUniversalIdentifier,
      );

      if (field === undefined) {
        throw new BadRequestException(
          'Every Formula reference must resolve inside the selected object.',
        );
      }
      if (field.id === outputFieldMetadataId) {
        throw new BadRequestException(
          'A Formula cannot reference its own output field.',
        );
      }
      if (field.type !== FieldMetadataType.NUMBER) {
        throw new BadRequestException(
          'The first Formula slice supports NUMBER source fields only.',
        );
      }
    }

    const compileResult = compileFormulaEditorDocument({
      document,
      resolveReference: (reference) => {
        if (reference.kind === 'RELATION') {
          const relationField = fieldsByUniversalIdentifier.get(
            reference.relationFieldMetadataUniversalIdentifier,
          );

          return relationField?.type === FieldMetadataType.RELATION &&
            relationField.relationTargetObjectMetadataId !== null &&
            relationField.relationTargetObjectMetadataId !== undefined
            ? {
                status: 'success',
                type: 'RELATION',
                nullable: false,
              }
            : { status: 'error', reason: 'NOT_FOUND' };
        }
        if (reference.kind !== 'FIELD') {
          return { status: 'error', reason: 'NOT_FOUND' };
        }

        const field = fieldsByUniversalIdentifier.get(
          reference.fieldMetadataUniversalIdentifier,
        );

        return field?.type === FieldMetadataType.NUMBER
          ? {
              status: 'success',
              type: 'NUMBER',
              nullable: field.isNullable !== false,
            }
          : { status: 'error', reason: 'NOT_FOUND' };
      },
    });

    if (compileResult.status === 'error') {
      throw new BadRequestException({
        message: 'Formula compilation failed.',
        diagnostics: compileResult.diagnostics,
      });
    }
    if (compileResult.compiledFormula.output.type !== 'NUMBER') {
      throw new BadRequestException(
        'The first Formula slice requires a NUMBER result.',
      );
    }

    const dependencyPlan =
      await this.formulaDependencyPlannerService.planProspectiveVersion({
        workspaceId,
        objectMetadataId,
        objectMetadataUniversalIdentifier: objectMetadata.universalIdentifier,
        outputFieldMetadataId,
        dependencies: compileResult.compiledFormula.dependencies,
      });

    await this.formulaAuthorizationService.assertCanReadDependencies({
      workspaceId,
      objectMetadataId,
      dependencyFieldMetadataIds:
        dependencyPlan.directDependencyFieldMetadataIds,
      dependencyObjectMetadataIds: [
        ...new Set(
          document.references.flatMap((reference) => {
            if (reference.kind !== 'RELATION') {
              return [];
            }

            const targetObjectMetadataId = fieldsByUniversalIdentifier.get(
              reference.relationFieldMetadataUniversalIdentifier,
            )?.relationTargetObjectMetadataId;

            return targetObjectMetadataId === null ||
              targetObjectMetadataId === undefined
              ? []
              : [targetObjectMetadataId];
          }),
        ),
      ],
    });

    return {
      compiledFormula: compileResult.compiledFormula,
      dependencyPlan,
    };
  }

  async getFormula({
    workspaceId,
    formulaDefinitionId,
  }: {
    workspaceId: string;
    formulaDefinitionId: string;
  }): Promise<FormulaDefinitionEntity> {
    const definition = await this.formulaMetadataService.findById({
      workspaceId,
      formulaDefinitionId,
    });

    if (definition === null) {
      throw new NotFoundException('Formula definition was not found.');
    }

    return definition;
  }

  recomputeRecord(
    input: RecomputeFormulaArgs,
  ): Promise<FormulaRecomputeResult> {
    return this.recomputeRecordInternal(input, true);
  }

  recomputeRecordAsSystem(
    input: RecomputeFormulaArgs,
  ): Promise<FormulaRecomputeResult> {
    return this.recomputeRecordInternal(input, false);
  }

  private async recomputeRecordInternal(
    { workspaceId, formulaDefinitionId, recordId }: RecomputeFormulaArgs,
    authorizeCaller: boolean,
  ): Promise<FormulaRecomputeResult> {
    const definition = await this.getFormula({
      workspaceId,
      formulaDefinitionId,
    });
    const activeVersion = definition.versions.find(
      ({ id }) => id === definition.activeVersionId,
    );

    if (activeVersion === undefined) {
      throw new BadRequestException(
        'Formula definition has no active version.',
      );
    }

    const [objectMetadata, fields] = await Promise.all([
      this.objectMetadataRepository.findOne({
        where: { id: definition.objectMetadataId, workspaceId },
      }),
      this.fieldMetadataRepository.find({
        where: {
          objectMetadataId: definition.objectMetadataId,
          workspaceId,
        },
      }),
    ]);

    if (objectMetadata === null) {
      throw new NotFoundException('Formula object metadata was not found.');
    }

    const outputField = fields.find(
      ({ id }) => id === definition.outputFieldMetadataId,
    );

    if (outputField === undefined) {
      throw new NotFoundException('Formula output field was not found.');
    }

    const fieldsByUniversalIdentifier = new Map(
      fields.map((field) => [field.universalIdentifier, field]),
    );
    const compiledFormula: CompiledFormula = {
      ast: activeVersion.ast,
      dependencies: activeVersion.dependencies,
      output: {
        type: activeVersion.outputType,
        nullable: activeVersion.isNullable,
      },
    };
    const relationDependencies = compiledFormula.dependencies.filter(
      (dependency) => dependency.kind === 'RELATION',
    );

    if (relationDependencies.length > 0 && outputField.isNullable !== true) {
      throw new BadRequestException(
        'Relation Formula output fields must be nullable so failed materializations cannot expose stale values.',
      );
    }

    if (authorizeCaller) {
      const dependencyFields = compiledFormula.dependencies.flatMap(
        (dependency) => {
          const universalIdentifier =
            dependency.kind === 'FIELD'
              ? dependency.fieldMetadataUniversalIdentifier
              : dependency.kind === 'RELATION'
                ? dependency.relationFieldMetadataUniversalIdentifier
                : null;
          const field =
            universalIdentifier === null
              ? undefined
              : fieldsByUniversalIdentifier.get(universalIdentifier);

          return field === undefined ? [] : [field];
        },
      );

      await this.formulaAuthorizationService.assertCanReadDependencies({
        workspaceId,
        objectMetadataId: definition.objectMetadataId,
        dependencyFieldMetadataIds: [
          ...new Set(dependencyFields.map(({ id }) => id)),
        ],
        dependencyObjectMetadataIds: [
          ...new Set(
            dependencyFields.flatMap(({ relationTargetObjectMetadataId }) =>
              relationTargetObjectMetadataId === null ||
              relationTargetObjectMetadataId === undefined
                ? []
                : [relationTargetObjectMetadataId],
            ),
          ),
        ],
      });
    }

    const authContext = buildSystemAuthContext(workspaceId);

    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const dataSource =
          await this.globalWorkspaceOrmManager.getGlobalWorkspaceDataSource();
        const queryRunner = dataSource.createQueryRunner();
        let transactionCommitted = false;

        await queryRunner.connect();
        await queryRunner.startTransaction('REPEATABLE READ');

        try {
          const repository = (
            queryRunner.manager as WorkspaceEntityManager
          ).getRepository<FormulaRecord>(
            objectMetadata.nameSingular,
            { shouldBypassPermissionChecks: true },
            authContext,
          );
          const record = await repository.findOne({
            where: { id: recordId } as FindOptionsWhere<FormulaRecord>,
            lock: { mode: 'pessimistic_write' },
          });

          if (record === null) {
            throw new NotFoundException('Formula record was not found.');
          }

          const updateMaterializedValue = async (value: number | null) => {
            await repository
              .createQueryBuilder('formulaRecord')
              .update()
              .set({
                [outputField.name]: value,
              } as unknown as QueryDeepPartialEntity<FormulaRecord>)
              .where('id = :recordId', { recordId })
              .execute();
          };

          const resolveRelationCounts = async (): Promise<
            Map<string, number>
          > => {
            const relationCounts = new Map<string, number>();

            for (const dependency of relationDependencies) {
              const relationField = fieldsByUniversalIdentifier.get(
                dependency.relationFieldMetadataUniversalIdentifier,
              );

              if (
                relationField === undefined ||
                relationField.type !== FieldMetadataType.RELATION
              ) {
                throw new BadRequestException(
                  'Formula relation metadata could not be resolved.',
                );
              }

              const countResult = await repository
                .createQueryBuilder('formulaRecord')
                .leftJoin(
                  `formulaRecord.${relationField.name}`,
                  'formulaRelatedRecord',
                )
                .select('COUNT(DISTINCT formulaRelatedRecord.id)', 'count')
                .where('formulaRecord.id = :recordId', { recordId })
                .getRawOne<{ count: string | number }>();
              const count = Number(countResult?.count ?? 0);

              if (!Number.isSafeInteger(count) || count < 0) {
                throw new BadRequestException(
                  'Formula relation count could not be resolved safely.',
                );
              }
              if (
                count > FORMULA_SECURITY_LIMITS.maxRelationRecordsPerEvaluation
              ) {
                await updateMaterializedValue(null);

                throw new FormulaRelationLimitExceededException(
                  `Formula relation count exceeds the ${FORMULA_SECURITY_LIMITS.maxRelationRecordsPerEvaluation} record limit.`,
                );
              }

              relationCounts.set(
                dependency.relationFieldMetadataUniversalIdentifier,
                count,
              );
            }

            return relationCounts;
          };

          const historicalResolutions = new Map<
            string,
            FormulaHistoricalValueResolution
          >();

          await Promise.all(
            collectHistoricalLookups(compiledFormula.ast.root).map(
              async (lookup) => {
                const field = fieldsByUniversalIdentifier.get(
                  lookup.fieldMetadataUniversalIdentifier,
                );

                if (field === undefined) {
                  historicalResolutions.set(historicalLookupKey(lookup), {
                    status: 'unavailable',
                  });

                  return;
                }

                let result: FormulaHistoryLookupResult;

                if (lookup.functionName === 'previousValue') {
                  result = await this.formulaHistoryService.previousValue({
                    workspaceId,
                    objectMetadataId: definition.objectMetadataId,
                    recordId,
                    fieldMetadataId: field.id,
                  });
                } else {
                  const at = new Date(lookup.at ?? '');

                  if (Number.isNaN(at.getTime())) {
                    throw new BadRequestException(
                      'valueAt requires a valid ISO timestamp.',
                    );
                  }
                  result = await this.formulaHistoryService.valueAt(
                    {
                      workspaceId,
                      objectMetadataId: definition.objectMetadataId,
                      recordId,
                      fieldMetadataId: field.id,
                    },
                    at,
                  );
                }

                historicalResolutions.set(
                  historicalLookupKey(lookup),
                  toHistoricalResolution(result),
                );
              },
            ),
          );

          const evaluateWithRelationCounts = (
            relationCounts: ReadonlyMap<string, number>,
          ) =>
            evaluateCompiledFormula({
              compiledFormula,
              resolveValue: (reference): FormulaValue | undefined => {
                if (reference.kind === 'RELATION') {
                  const count = relationCounts.get(
                    reference.relationFieldMetadataUniversalIdentifier,
                  );

                  return count === undefined
                    ? undefined
                    : { type: 'RELATION', value: count };
                }
                if (reference.kind !== 'FIELD') {
                  return undefined;
                }

                const field = fieldsByUniversalIdentifier.get(
                  reference.fieldMetadataUniversalIdentifier,
                );

                if (field === undefined) {
                  return undefined;
                }

                const rawValue = record[field.name];

                if (rawValue === null || rawValue === undefined) {
                  return { type: 'NULL', value: null };
                }
                if (
                  typeof rawValue !== 'number' ||
                  !Number.isFinite(rawValue)
                ) {
                  return undefined;
                }

                return { type: 'NUMBER', value: rawValue };
              },
              resolveHistoricalValue: (request) => {
                if (request.reference.kind !== 'FIELD') {
                  return { status: 'unavailable' };
                }

                return (
                  historicalResolutions.get(
                    historicalLookupKey({
                      functionName: request.functionName,
                      fieldMetadataUniversalIdentifier:
                        request.reference.fieldMetadataUniversalIdentifier,
                      at: request.at,
                    }),
                  ) ?? { status: 'unavailable' }
                );
              },
              limits: {
                maxRelationItems:
                  FORMULA_SECURITY_LIMITS.maxRelationRecordsPerEvaluation,
              },
            });
          let evaluation:
            | ReturnType<typeof evaluateCompiledFormula>
            | undefined;

          if (relationDependencies.length === 0) {
            evaluation = evaluateWithRelationCounts(new Map());
          } else {
            for (let attempt = 0; attempt < 3; attempt += 1) {
              const relationCounts = await resolveRelationCounts();
              const candidate = evaluateWithRelationCounts(relationCounts);
              const verifiedRelationCounts = await resolveRelationCounts();

              if (
                relationCountMapsAreEqual(
                  relationCounts,
                  verifiedRelationCounts,
                )
              ) {
                evaluation = candidate;
                break;
              }
            }
          }

          if (evaluation === undefined) {
            throw new BadRequestException(
              'Formula relation values changed during evaluation. Retry the recompute.',
            );
          }

          if (evaluation.status === 'error') {
            throw new BadRequestException({
              message: 'Formula evaluation failed.',
              diagnostics: evaluation.diagnostics,
            });
          }
          if (
            evaluation.value.type !== 'NUMBER' &&
            evaluation.value.type !== 'NULL'
          ) {
            throw new BadRequestException(
              'Formula result does not match its NUMBER output field.',
            );
          }

          const value =
            evaluation.value.type === 'NULL' ? null : evaluation.value.value;

          await updateMaterializedValue(value);
          const recordEffectiveAt =
            record.updatedAt instanceof Date
              ? record.updatedAt
              : typeof record.updatedAt === 'string'
                ? new Date(record.updatedAt)
                : new Date();
          const effectiveAt = Number.isNaN(recordEffectiveAt.getTime())
            ? new Date()
            : recordEffectiveAt;

          await queryRunner.commitTransaction();
          transactionCommitted = true;

          const historyReceipt =
            await this.formulaHistoryService.appendFormulaMaterialization({
              workspaceId,
              objectMetadataId: definition.objectMetadataId,
              recordId,
              fieldMetadataId: outputField.id,
              formulaDefinitionId: definition.id,
              formulaVersionId: activeVersion.id,
              beforeValue: record[outputField.name],
              afterValue: value,
              effectiveAt,
            });

          return {
            formulaDefinitionId: definition.id,
            formulaVersionId: activeVersion.id,
            recordId,
            outputFieldName: outputField.name,
            value,
            evaluatorVersion: evaluation.evaluatorVersion,
            instructionCount: evaluation.instructionCount,
            historyReceiptId: historyReceipt.evaluationReceiptId,
            historyAppended: historyReceipt.inserted,
          };
        } catch (error) {
          if (!transactionCommitted) {
            if (error instanceof FormulaRelationLimitExceededException) {
              await queryRunner.commitTransaction();
            } else {
              await queryRunner.rollbackTransaction();
            }
          }

          throw error;
        } finally {
          await queryRunner.release();
        }
      },
      authContext,
    );
  }
}
