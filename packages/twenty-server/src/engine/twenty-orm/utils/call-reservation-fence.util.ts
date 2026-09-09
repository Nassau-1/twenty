import { FieldMetadataType } from 'twenty-shared/types';
import { type ObjectLiteral, type QueryBuilder } from 'typeorm';

import { type ObjectRecordFilter } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';
import {
  TwentyORMException,
  TwentyORMExceptionCode,
} from 'src/engine/twenty-orm/exceptions/twenty-orm.exception';

export type CallReservationTransition = {
  callId: string;
  reservation: string;
  meetingId: string | null;
};

const RESERVATION =
  /^zo-pending:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BINDING_FIELDS = new Set([
  'vexaMeetingId',
  'updatedAt',
  'updatedBy',
  'updatedBySource',
  'updatedByWorkspaceMemberId',
  'updatedByName',
  'updatedByContext',
]);

export function validateCallReservationValues(
  object: FlatObjectMetadata,
  context: Pick<WorkspaceInternalContext, 'flatFieldMetadataMaps'>,
  values: ObjectLiteral | ObjectLiteral[] | undefined,
) {
  if (!isReservedCallObject(object, context)) return;
  for (const value of Array.isArray(values) ? values : [values]) {
    const binding = value?.vexaMeetingId;
    if (
      typeof binding === 'function' ||
      (typeof binding === 'string' &&
        binding.startsWith('zo-pending:') &&
        !RESERVATION.test(binding))
    ) {
      throw new TwentyORMException(
        'Invalid Call reservation marker',
        TwentyORMExceptionCode.INVALID_INPUT,
      );
    }
  }
}

// Preserve caller OR precedence; the invariant must apply to every branch.
export function appendCallReservationFence(
  builder: QueryBuilder<ObjectLiteral>,
  fence: ReturnType<typeof callReservationFence>,
) {
  if (!fence) return;
  const existing = builder.expressionMap.wheres;
  builder.expressionMap.wheres = [
    ...(existing.length
      ? [
          {
            type: 'simple' as const,
            condition: { operator: 'brackets' as const, condition: existing },
          },
        ]
      : []),
    { type: 'and', condition: fence.condition },
  ];
  builder.setParameters(fence.parameters);
}

export function affectedCallRows<T extends ObjectLiteral>(
  before: T[],
  returned: ObjectLiteral[],
): T[] {
  const ids = new Set(returned.map((row) => row.id));
  return before.filter((row) => ids.has(row.id));
}

export function projectCallReturnedRows(
  rows: ObjectLiteral[],
  returning: string | string[],
) {
  if (returning === '*') return rows;
  const columns = new Set(Array.isArray(returning) ? returning : []);
  return rows.map((row) =>
    Object.fromEntries(Object.entries(row).filter(([key]) => columns.has(key))),
  );
}

type FileIds = {
  toAdd: Set<string>;
  toUpdate: Set<string>;
  toRemove: Set<string>;
};
type FileDiff = Record<
  number,
  Record<string, Record<keyof FileIds, { fileId: string }[]>>
>;

export function affectedCallFileIds(
  fileIds: FileIds,
  diff: FileDiff,
  indices: Set<number>,
): FileIds {
  const result: FileIds = {
    toAdd: new Set(),
    toUpdate: new Set(),
    toRemove: new Set(),
  };
  for (const index of indices) {
    for (const field of Object.values(diff[index] ?? {})) {
      for (const kind of ['toAdd', 'toUpdate', 'toRemove'] as const) {
        for (const file of field[kind]) {
          if (fileIds[kind].has(file.fileId)) result[kind].add(file.fileId);
        }
      }
    }
  }
  return result;
}

export function insertedCallFileIds(
  fileIds: FileIds,
  diff: FileDiff,
  returned: ObjectLiteral[],
): FileIds {
  const fields = new Set(
    Object.values(diff).flatMap((entry) => Object.keys(entry)),
  );
  const inserted = new Set<string>();
  for (const row of returned) {
    for (const field of fields) {
      const files: unknown = row[field];
      if (!Array.isArray(files)) continue;
      for (const file of files) {
        if (typeof file?.fileId === 'string') inserted.add(file.fileId);
      }
    }
  }
  // Insert diffs have no previous attachments to remove. Never synchronize
  // files from skipped upsert inputs or rely on TypeORM's padded identifiers.
  return {
    toAdd: new Set([...fileIds.toAdd].filter((id) => inserted.has(id))),
    toUpdate: new Set([...fileIds.toUpdate].filter((id) => inserted.has(id))),
    toRemove: new Set(),
  };
}

export const isReservedCallObject = (
  object: FlatObjectMetadata,
  context: Pick<WorkspaceInternalContext, 'flatFieldMetadataMaps'>,
) =>
  object.nameSingular === 'call' &&
  Object.values(context.flatFieldMetadataMaps.byUniversalIdentifier).some(
    (field) =>
      field?.objectMetadataId === object.id &&
      field.name === 'vexaMeetingId' &&
      field.type === FieldMetadataType.TEXT,
  );

export function getCallReservationTransition(
  filter: Partial<ObjectRecordFilter> | undefined,
  data: ObjectLiteral,
): CallReservationTransition | undefined {
  const callId = filter?.id?.eq;
  const reservation = filter?.vexaMeetingId?.eq;
  const meetingId = data.vexaMeetingId;
  if (
    typeof callId !== 'string' ||
    !UUID.test(callId) ||
    typeof reservation !== 'string' ||
    !RESERVATION.test(reservation) ||
    !Object.keys(data).every((key) => BINDING_FIELDS.has(key)) ||
    !(
      meetingId === null ||
      (typeof meetingId === 'string' &&
        /^(0|[1-9][0-9]*)$/.test(meetingId) &&
        Number.isSafeInteger(Number(meetingId)))
    )
  )
    return;

  return { callId, reservation, meetingId };
}

export function callReservationFence(
  object: FlatObjectMetadata,
  context: Pick<WorkspaceInternalContext, 'flatFieldMetadataMaps'>,
  escape: (name: string) => string,
  transition?: CallReservationTransition,
  alias?: string,
) {
  if (!isReservedCallObject(object, context)) return;

  const table = escape(alias ?? computeObjectTargetTable(object));
  const column = `${table}.${escape('vexaMeetingId')}`;
  const condition = `${column} IS NULL OR ${column} NOT LIKE :zoCallReservationPrefix`;

  return {
    condition: `(${condition}${transition ? ` OR (${column} = :zoCallReservationOwner AND ${table}.${escape('id')} = :zoCallReservationId)` : ''})`,
    parameters: {
      zoCallReservationPrefix: 'zo-pending:%',
      ...(transition
        ? {
            zoCallReservationOwner: transition.reservation,
            zoCallReservationId: transition.callId,
          }
        : {}),
    },
  };
}
