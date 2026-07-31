import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

export enum FormulaFieldHistoryOrigin {
  FIELD = 'FIELD',
  FORMULA = 'FORMULA',
}

@Entity('formulaFieldHistory')
@Unique('IDX_FORMULA_FIELD_HISTORY_EVENT_KEY_UNIQUE', [
  'workspaceId',
  'eventKey',
])
@Index('IDX_FORMULA_FIELD_HISTORY_LOOKUP', [
  'workspaceId',
  'objectMetadataId',
  'recordId',
  'fieldMetadataId',
  'effectiveAt',
  'sequence',
])
export class FormulaFieldHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', generated: 'increment' })
  sequence: string;

  @Column({ type: 'uuid' })
  workspaceId: string;

  @Column({ type: 'uuid' })
  objectMetadataId: string;

  @Column({ type: 'uuid' })
  recordId: string;

  @Column({ type: 'uuid' })
  fieldMetadataId: string;

  @Column({ type: 'varchar' })
  origin: FormulaFieldHistoryOrigin;

  @Column({ type: 'uuid', nullable: true })
  formulaDefinitionId: string | null;

  @Column({ type: 'uuid', nullable: true })
  formulaVersionId: string | null;

  @Column({ type: 'uuid', nullable: true })
  evaluationReceiptId: string | null;

  @Column({ type: 'varchar', length: 64 })
  eventKey: string;

  @Column({ type: 'jsonb', nullable: true })
  beforeValue: unknown | null;

  @Column({ type: 'jsonb', nullable: true })
  afterValue: unknown | null;

  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'uuid', nullable: true })
  actorWorkspaceMemberId: string | null;

  @Column({ type: 'timestamptz' })
  effectiveAt: Date;

  @Column({ type: 'timestamptz' })
  observedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
