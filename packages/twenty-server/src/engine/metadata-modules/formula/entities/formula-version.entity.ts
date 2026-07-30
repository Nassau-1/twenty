import {
  type FormulaAst,
  type FormulaEditorDocument,
  type FormulaReferenceNode,
} from 'twenty-shared/formula';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';

import { FormulaDefinitionEntity } from 'src/engine/metadata-modules/formula/entities/formula-definition.entity';
import { JsonbProperty } from 'src/engine/workspace-manager/workspace-migration/universal-flat-entity/types/jsonb-property.type';

@Entity('formulaVersion')
@Index('IDX_FORMULA_VERSION_DEFINITION_CREATED_AT', [
  'definitionId',
  'createdAt',
])
export class FormulaVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  definitionId: string;

  @ManyToOne(
    () => FormulaDefinitionEntity,
    (formulaDefinition) => formulaDefinition.versions,
    { onDelete: 'CASCADE' },
  )
  @JoinColumn({ name: 'definitionId' })
  definition: Relation<FormulaDefinitionEntity>;

  @Column({ type: 'jsonb' })
  editorDocument: JsonbProperty<FormulaEditorDocument>;

  @Column({ type: 'jsonb' })
  ast: JsonbProperty<FormulaAst>;

  @Column({ type: 'jsonb' })
  dependencies: JsonbProperty<FormulaReferenceNode['reference'][]>;

  @Column({ type: 'varchar' })
  outputType: 'BOOLEAN' | 'NUMBER' | 'TEXT';

  @Column({ type: 'boolean' })
  isNullable: boolean;

  @Column({ type: 'varchar' })
  compilerVersion: string;

  @Column({ type: 'uuid', nullable: true })
  createdByWorkspaceMemberId: string | null;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
