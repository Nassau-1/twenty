import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { FormulaVersionEntity } from 'src/engine/metadata-modules/formula/entities/formula-version.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';

@Entity('formulaDefinition')
@Unique('IDX_FORMULA_DEFINITION_OUTPUT_FIELD_UNIQUE', [
  'workspaceId',
  'objectMetadataId',
  'outputFieldMetadataId',
])
@Index('IDX_FORMULA_DEFINITION_WORKSPACE_OBJECT', [
  'workspaceId',
  'objectMetadataId',
])
export class FormulaDefinitionEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  workspaceId: string;

  @ManyToOne(() => WorkspaceEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workspaceId' })
  workspace: Relation<WorkspaceEntity>;

  @Column({ type: 'uuid' })
  objectMetadataId: string;

  @ManyToOne(() => ObjectMetadataEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'objectMetadataId' })
  objectMetadata: Relation<ObjectMetadataEntity>;

  @Column({ type: 'uuid' })
  outputFieldMetadataId: string;

  @OneToOne(() => FieldMetadataEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'outputFieldMetadataId' })
  outputFieldMetadata: Relation<FieldMetadataEntity>;

  @Column({ type: 'uuid', nullable: true })
  activeVersionId: string | null;

  @OneToMany(
    () => FormulaVersionEntity,
    (formulaVersion) => formulaVersion.definition,
  )
  versions: Relation<FormulaVersionEntity[]>;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
