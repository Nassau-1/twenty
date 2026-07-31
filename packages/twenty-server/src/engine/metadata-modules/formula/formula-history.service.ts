import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { createHash, randomUUID } from 'node:crypto';
import { type ObjectRecordUpdateEvent } from 'twenty-shared/database-events';
import { type FormulaValue } from 'twenty-shared/formula';
import { LessThanOrEqual, type Repository } from 'typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import {
  FormulaFieldHistoryEntity,
  FormulaFieldHistoryOrigin,
} from 'src/engine/metadata-modules/formula/entities/formula-field-history.entity';
import { InjectWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/inject-workspace-scoped-repository.decorator';
import { WorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/workspace-scoped-repository';
import { type WorkspaceEventBatch } from 'src/engine/workspace-event-emitter/types/workspace-event-batch.type';

type HistoryLookup = {
  workspaceId: string;
  objectMetadataId: string;
  recordId: string;
  fieldMetadataId: string;
};

export type FormulaHistoryLookupResult =
  | {
      status: 'available';
      value: FormulaValue;
      effectiveAt: Date;
      sequence: string;
    }
  | {
      status: 'unavailable';
      coverageStartedAt: Date | null;
    };

const asHistoryValue = (value: unknown): unknown | null =>
  value === undefined ? null : value;

const asFormulaValue = (value: unknown): FormulaValue | undefined => {
  if (value === null) {
    return { type: 'NULL', value: null };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { type: 'NUMBER', value };
  }
  if (typeof value === 'string') {
    return { type: 'TEXT', value };
  }
  if (typeof value === 'boolean') {
    return { type: 'BOOLEAN', value };
  }

  return undefined;
};

const effectiveAtFromRecord = (
  record: Record<string, unknown>,
  fallback: Date,
): Date => {
  const rawUpdatedAt = record.updatedAt;
  const candidate =
    rawUpdatedAt instanceof Date
      ? rawUpdatedAt
      : typeof rawUpdatedAt === 'string'
        ? new Date(rawUpdatedAt)
        : fallback;

  return Number.isNaN(candidate.getTime()) ? fallback : candidate;
};

const eventKeyFor = (parts: unknown[]): string =>
  createHash('sha256').update(JSON.stringify(parts)).digest('hex');

@Injectable()
export class FormulaHistoryService {
  constructor(
    @InjectRepository(FieldMetadataEntity)
    private readonly fieldMetadataRepository: Repository<FieldMetadataEntity>,
    @InjectWorkspaceScopedRepository(FormulaFieldHistoryEntity)
    private readonly historyRepository: WorkspaceScopedRepository<FormulaFieldHistoryEntity>,
  ) {}

  async captureFieldUpdates(
    batch: WorkspaceEventBatch<
      ObjectRecordUpdateEvent<Record<string, unknown>>
    >,
    trackedFieldMetadataIds: ReadonlySet<string>,
    excludedFieldMetadataIds: ReadonlySet<string>,
  ): Promise<number> {
    if (trackedFieldMetadataIds.size === 0) {
      return 0;
    }

    const fields = await this.fieldMetadataRepository.find({
      where: {
        workspaceId: batch.workspaceId,
        objectMetadataId: batch.objectMetadata.id,
      },
    });
    const fieldByName = new Map(fields.map((field) => [field.name, field]));
    const observedAt = new Date();
    const entries: Array<Partial<FormulaFieldHistoryEntity>> = [];

    for (const event of batch.events) {
      const effectiveAt = effectiveAtFromRecord(
        event.properties.after,
        observedAt,
      );

      for (const fieldName of event.properties.updatedFields) {
        const field = fieldByName.get(fieldName);

        if (
          field === undefined ||
          !trackedFieldMetadataIds.has(field.id) ||
          excludedFieldMetadataIds.has(field.id) ||
          fieldName === 'updatedAt'
        ) {
          continue;
        }

        const beforeValue = asHistoryValue(event.properties.before[fieldName]);
        const afterValue = asHistoryValue(event.properties.after[fieldName]);
        const eventKey = eventKeyFor([
          'FIELD',
          batch.workspaceId,
          batch.objectMetadata.id,
          event.recordId,
          field.id,
          effectiveAt.toISOString(),
          beforeValue,
          afterValue,
        ]);

        entries.push({
          workspaceId: batch.workspaceId,
          objectMetadataId: batch.objectMetadata.id,
          recordId: event.recordId,
          fieldMetadataId: field.id,
          origin: FormulaFieldHistoryOrigin.FIELD,
          formulaDefinitionId: null,
          formulaVersionId: null,
          evaluationReceiptId: null,
          eventKey,
          beforeValue,
          afterValue,
          actorUserId: event.userId ?? null,
          actorWorkspaceMemberId: event.workspaceMemberId ?? null,
          effectiveAt,
          observedAt,
        });
      }
    }

    if (entries.length === 0) {
      return 0;
    }

    const result = await this.historyRepository
      .createQueryBuilder()
      .insert()
      .values(entries)
      .orIgnore()
      .execute();

    return result.identifiers.length;
  }

  async appendFormulaMaterialization({
    workspaceId,
    objectMetadataId,
    recordId,
    fieldMetadataId,
    formulaDefinitionId,
    formulaVersionId,
    beforeValue,
    afterValue,
    effectiveAt,
  }: HistoryLookup & {
    formulaDefinitionId: string;
    formulaVersionId: string;
    beforeValue: unknown;
    afterValue: unknown;
    effectiveAt: Date;
  }): Promise<{ evaluationReceiptId: string; inserted: boolean }> {
    if (Object.is(beforeValue, afterValue)) {
      return { evaluationReceiptId: randomUUID(), inserted: false };
    }

    const evaluationReceiptId = randomUUID();
    const normalizedBeforeValue = asHistoryValue(beforeValue);
    const normalizedAfterValue = asHistoryValue(afterValue);
    const eventKey = eventKeyFor([
      'FORMULA',
      workspaceId,
      objectMetadataId,
      recordId,
      fieldMetadataId,
      formulaDefinitionId,
      formulaVersionId,
      effectiveAt.toISOString(),
      normalizedBeforeValue,
      normalizedAfterValue,
    ]);
    const result = await this.historyRepository
      .createQueryBuilder()
      .insert()
      .values({
        workspaceId,
        objectMetadataId,
        recordId,
        fieldMetadataId,
        origin: FormulaFieldHistoryOrigin.FORMULA,
        formulaDefinitionId,
        formulaVersionId,
        evaluationReceiptId,
        eventKey,
        beforeValue: normalizedBeforeValue,
        afterValue: normalizedAfterValue,
        actorUserId: null,
        actorWorkspaceMemberId: null,
        effectiveAt,
        observedAt: new Date(),
      })
      .orIgnore()
      .execute();

    return {
      evaluationReceiptId,
      inserted: result.identifiers.length > 0,
    };
  }

  async previousValue(
    lookup: HistoryLookup,
  ): Promise<FormulaHistoryLookupResult> {
    const latest = await this.historyRepository.findOne(lookup.workspaceId, {
      where: {
        objectMetadataId: lookup.objectMetadataId,
        recordId: lookup.recordId,
        fieldMetadataId: lookup.fieldMetadataId,
      },
      order: { effectiveAt: 'DESC', sequence: 'DESC' },
    });

    if (latest === null) {
      return { status: 'unavailable', coverageStartedAt: null };
    }

    const value = asFormulaValue(latest.beforeValue);

    return value === undefined
      ? {
          status: 'unavailable',
          coverageStartedAt: latest.effectiveAt,
        }
      : {
          status: 'available',
          value,
          effectiveAt: latest.effectiveAt,
          sequence: latest.sequence,
        };
  }

  async valueAt(
    lookup: HistoryLookup,
    at: Date,
  ): Promise<FormulaHistoryLookupResult> {
    const [earliest, latestAtOrBefore] = await Promise.all([
      this.historyRepository.findOne(lookup.workspaceId, {
        where: {
          objectMetadataId: lookup.objectMetadataId,
          recordId: lookup.recordId,
          fieldMetadataId: lookup.fieldMetadataId,
        },
        order: { effectiveAt: 'ASC', sequence: 'ASC' },
      }),
      this.historyRepository.findOne(lookup.workspaceId, {
        where: {
          objectMetadataId: lookup.objectMetadataId,
          recordId: lookup.recordId,
          fieldMetadataId: lookup.fieldMetadataId,
          effectiveAt: LessThanOrEqual(at),
        },
        order: { effectiveAt: 'DESC', sequence: 'DESC' },
      }),
    ]);

    if (
      earliest === null ||
      latestAtOrBefore === null ||
      at < earliest.effectiveAt
    ) {
      return {
        status: 'unavailable',
        coverageStartedAt: earliest?.effectiveAt ?? null,
      };
    }

    const value = asFormulaValue(latestAtOrBefore.afterValue);

    return value === undefined
      ? {
          status: 'unavailable',
          coverageStartedAt: earliest.effectiveAt,
        }
      : {
          status: 'available',
          value,
          effectiveAt: latestAtOrBefore.effectiveAt,
          sequence: latestAtOrBefore.sequence,
        };
  }
}
