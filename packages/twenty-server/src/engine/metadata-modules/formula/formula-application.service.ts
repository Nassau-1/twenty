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
  type FormulaEditorDocument,
  type FormulaValue,
} from 'twenty-shared/formula';
import { FieldMetadataType } from 'twenty-shared/types';
import { type FindOptionsWhere, type ObjectLiteral, Repository } from 'typeorm';
import { type QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import {
  type FormulaDependencyPlan,
  FormulaDependencyPlannerService,
} from 'src/engine/metadata-modules/formula/formula-dependency-planner.service';
import { FormulaMetadataService } from 'src/engine/metadata-modules/formula/formula-metadata.service';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';

type FormulaRecord = ObjectLiteral & {
  id: string;
};

type CreateFormulaArgs = {
  workspaceId: string;
  objectMetadataId: string;
  outputFieldMetadataId: string;
  document: FormulaEditorDocument;
  reason: string | null;
};

@Injectable()
export class FormulaApplicationService {
  constructor(
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
    @InjectRepository(ObjectMetadataEntity)
    private readonly objectMetadataRepository: Repository<ObjectMetadataEntity>,
    private readonly formulaDependencyPlannerService: FormulaDependencyPlannerService,
    private readonly formulaMetadataService: FormulaMetadataService,
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

  private async prepareFormula({
    workspaceId,
    objectMetadataId,
    outputFieldMetadataId,
    document,
  }: CreateFormulaArgs): Promise<{
    compiledFormula: CompiledFormula;
    dependencyPlan: FormulaDependencyPlan;
  }> {
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

    const fieldsByUniversalIdentifier = new Map(
      fields.map((field) => [field.universalIdentifier, field]),
    );

    for (const reference of document.references) {
      if (reference.kind !== 'FIELD') {
        throw new BadRequestException(
          'The first Formula slice supports direct field references only.',
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

  async recomputeRecord({
    workspaceId,
    formulaDefinitionId,
    recordId,
  }: {
    workspaceId: string;
    formulaDefinitionId: string;
    recordId: string;
  }): Promise<{
    formulaDefinitionId: string;
    formulaVersionId: string;
    recordId: string;
    outputFieldName: string;
    value: number | null;
    evaluatorVersion: string;
    instructionCount: number;
  }> {
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
          throw new NotFoundException('Formula record was not found.');
        }

        const evaluation = evaluateCompiledFormula({
          compiledFormula,
          resolveValue: (reference): FormulaValue | undefined => {
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
            if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
              return undefined;
            }

            return { type: 'NUMBER', value: rawValue };
          },
        });

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

        await repository.update(recordId, {
          [outputField.name]: value,
        } as unknown as QueryDeepPartialEntity<FormulaRecord>);

        return {
          formulaDefinitionId: definition.id,
          formulaVersionId: activeVersion.id,
          recordId,
          outputFieldName: outputField.name,
          value,
          evaluatorVersion: evaluation.evaluatorVersion,
          instructionCount: evaluation.instructionCount,
        };
      },
      authContext,
    );
  }
}
