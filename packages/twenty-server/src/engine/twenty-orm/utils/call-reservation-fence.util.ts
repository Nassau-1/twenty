import { FieldMetadataType } from 'twenty-shared/types';
import { type ObjectLiteral } from 'typeorm';

import { type ObjectRecordFilter } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';
import { type FlatObjectMetadata } from 'src/engine/metadata-modules/flat-object-metadata/types/flat-object-metadata.type';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import { computeObjectTargetTable } from 'src/engine/utils/compute-object-target-table.util';

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
