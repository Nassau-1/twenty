import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  type CompiledFormula,
  type FormulaEditorDocument,
} from 'twenty-shared/formula';
import { DataSource, type DeepPartial, Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { FormulaVersionEntity } from 'src/engine/metadata-modules/formula/entities/formula-version.entity';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';

export type CreateFormulaDefinitionInput = {
  workspaceId: string;
  objectMetadataId: string;
  outputFieldMetadataId: string;
  editorDocument: FormulaEditorDocument;
  compiledFormula: CompiledFormula;
  createdByWorkspaceMemberId: string | null;
  reason: string | null;
};

@Injectable()
export class FormulaMetadataService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
    @InjectWorkspaceScopedRepository(FormulaDefinitionEntity)
    private readonly formulaDefinitionRepository: WorkspaceScopedRepository<FormulaDefinitionEntity>,
  ) {}

  async createDefinitionWithActiveVersion(
    input: CreateFormulaDefinitionInput,
  ): Promise<FormulaDefinitionEntity> {
    const outputField = await this.fieldMetadataRepository.findOne({
      where: {
        id: input.outputFieldMetadataId,
        objectMetadataId: input.objectMetadataId,
        workspaceId: input.workspaceId,
      },
    });

    if (outputField === null) {
      throw new Error(
        'Formula output field must belong to the requested workspace and object.',
      );
    }

    return this.dataSource.transaction(async (entityManager) => {
      const definitionRepository =
        this.formulaDefinitionRepository.withManager(entityManager);
      const versionRepository =
        entityManager.getRepository(FormulaVersionEntity);

      const definition = await definitionRepository.save<
        DeepPartial<FormulaDefinitionEntity>
      >(input.workspaceId, {
        objectMetadataId: input.objectMetadataId,
        outputFieldMetadataId: input.outputFieldMetadataId,
        activeVersionId: null,
      });
      const version = await versionRepository.save(
        versionRepository.create({
          definitionId: definition.id,
          editorDocument: input.editorDocument,
          ast: input.compiledFormula.ast,
          dependencies: input.compiledFormula.dependencies,
          outputType: input.compiledFormula.output.type,
          isNullable: input.compiledFormula.output.nullable,
          compilerVersion: String(input.compiledFormula.ast.version),
          createdByWorkspaceMemberId: input.createdByWorkspaceMemberId,
          reason: input.reason,
        }),
      );

      definition.activeVersionId = version.id;
      return definitionRepository.save(input.workspaceId, definition);
    });
  }

  findByOutputField({
    workspaceId,
    outputFieldMetadataId,
  }: {
    workspaceId: string;
    outputFieldMetadataId: string;
  }): Promise<FormulaDefinitionEntity | null> {
    return this.formulaDefinitionRepository.findOne(workspaceId, {
      where: { outputFieldMetadataId },
      relations: { versions: true },
    });
  }

  findById({
    workspaceId,
    formulaDefinitionId,
  }: {
    workspaceId: string;
    formulaDefinitionId: string;
  }): Promise<FormulaDefinitionEntity | null> {
    return this.formulaDefinitionRepository.findOne(workspaceId, {
      where: { id: formulaDefinitionId },
      relations: { versions: true },
    });
  }
}
