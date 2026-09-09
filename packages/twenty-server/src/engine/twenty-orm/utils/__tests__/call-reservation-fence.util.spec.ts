import { FieldMetadataType } from 'twenty-shared/types';
import { DataSource, EntitySchema } from 'typeorm';

import { getFlatFieldMetadataMock } from 'src/engine/metadata-modules/flat-field-metadata/__mocks__/get-flat-field-metadata.mock';
import { getFlatObjectMetadataMock } from 'src/engine/metadata-modules/flat-object-metadata/__mocks__/get-flat-object-metadata.mock';
import { type WorkspaceInternalContext } from 'src/engine/twenty-orm/interfaces/workspace-internal-context.interface';
import {
  callReservationFence,
  getCallReservationTransition,
  isReservedCallObject,
  appendCallReservationFence,
  validateCallReservationValues,
  affectedCallRows,
  affectedCallFileIds,
  insertedCallFileIds,
  projectCallReturnedRows,
} from 'src/engine/twenty-orm/utils/call-reservation-fence.util';

const id = '00000000-0000-4000-8000-000000000001';
const reservation = 'zo-pending:00000000-0000-4000-8000-000000000002';
const object = getFlatObjectMetadataMock({
  id: 'call-object',
  nameSingular: 'call',
  fieldIds: ['binding'],
});
const field = getFlatFieldMetadataMock({
  id: 'binding',
  objectMetadataId: object.id,
  name: 'vexaMeetingId',
  type: FieldMetadataType.TEXT,
});
const context = {
  flatFieldMetadataMaps: {
    byUniversalIdentifier: { binding: field },
    universalIdentifierById: { binding: 'binding' },
    universalIdentifiersByApplicationId: {},
  },
} as Pick<WorkspaceInternalContext, 'flatFieldMetadataMaps'>;
const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;

describe('Call reservation producer fence', () => {
  it.each([
    'zo-pending:',
    'zo-pending:other',
    'zo-pending:ABCDEFAB-0000-4000-8000-000000000002',
    () => "'zo-pending:other'",
  ])('rejects malformed marker writes before SQL', (vexaMeetingId) => {
    expect(() =>
      validateCallReservationValues(object, context, { vexaMeetingId }),
    ).toThrow('Invalid Call reservation marker');
  });

  it('accepts valid new markers and ordinary bindings without changing unrelated objects', () => {
    for (const vexaMeetingId of [undefined, null, '', '37', reservation]) {
      expect(() =>
        validateCallReservationValues(object, context, { vexaMeetingId }),
      ).not.toThrow();
    }
    expect(() =>
      validateCallReservationValues(
        { ...object, nameSingular: 'company' },
        context,
        { vexaMeetingId: 'zo-pending:other' },
      ),
    ).not.toThrow();
  });

  it('restricts bookkeeping to actual RETURNING rows, including mixed bulk results', () => {
    const before = [{ id: 'one' }, { id: 'two' }];
    expect(affectedCallRows(before, [])).toEqual([]);
    expect(affectedCallRows(before, [{ id: 'two' }])).toEqual([{ id: 'two' }]);
    expect(
      projectCallReturnedRows([{ id: 'two', private: 'not-selected' }], ['id']),
    ).toEqual([{ id: 'two' }]);
    expect(
      projectCallReturnedRows([{ id: 'two', private: 'not-selected' }], 'id'),
    ).toEqual([{ id: 'two' }]);
  });

  it('does not synchronize files from rejected update or upsert inputs', () => {
    const fileIds = {
      toAdd: new Set(['new-one', 'new-two']),
      toUpdate: new Set<string>(),
      toRemove: new Set(['old-one', 'old-two']),
    };
    const diff = {
      0: {
        files: {
          toAdd: [{ fileId: 'new-one' }],
          toUpdate: [],
          toRemove: [{ fileId: 'old-one' }],
        },
      },
      1: {
        files: {
          toAdd: [{ fileId: 'new-two' }],
          toUpdate: [],
          toRemove: [{ fileId: 'old-two' }],
        },
      },
    };
    expect(affectedCallFileIds(fileIds, diff, new Set([1]))).toEqual({
      toAdd: new Set(['new-two']),
      toUpdate: new Set(),
      toRemove: new Set(['old-two']),
    });
    expect(insertedCallFileIds(fileIds, diff, [])).toEqual({
      toAdd: new Set(),
      toUpdate: new Set(),
      toRemove: new Set(),
    });
    expect(
      insertedCallFileIds(fileIds, diff, [{ files: [{ fileId: 'new-two' }] }]),
    ).toEqual({
      toAdd: new Set(['new-two']),
      toUpdate: new Set(),
      toRemove: new Set(),
    });
  });
  it('only guards Calls with the actual text binding field', () => {
    expect(isReservedCallObject(object, context)).toBe(true);
    expect(
      callReservationFence(
        { ...object, nameSingular: 'company' },
        context,
        escape,
      ),
    ).toBeUndefined();
    expect(
      callReservationFence(
        object,
        {
          flatFieldMetadataMaps: {
            ...context.flatFieldMetadataMaps,
            byUniversalIdentifier: {},
          },
        },
        escape,
      ),
    ).toBeUndefined();
    expect(
      callReservationFence(
        object,
        {
          flatFieldMetadataMaps: {
            ...context.flatFieldMetadataMaps,
            byUniversalIdentifier: {
              binding: { ...field, objectMetadataId: 'other' },
            },
          },
        },
        escape,
      ),
    ).toBeUndefined();
  });

  it.each([null, '0', '37'])(
    'allows only explicit id-and-marker binding transition to %s',
    (meetingId) => {
      expect(
        getCallReservationTransition(
          { id: { eq: id }, vexaMeetingId: { eq: reservation } },
          { vexaMeetingId: meetingId, updatedBy: {} },
        ),
      ).toEqual({ callId: id, reservation, meetingId });
    },
  );

  it.each([
    'name',
    'scheduledStart',
    'meetingUrl',
    'companyId',
    'opportunityId',
    'company',
    'opportunity',
    'deletedAt',
    'id',
  ])('rejects mixed transition with %s', (key) => {
    expect(
      getCallReservationTransition(
        { id: { eq: id }, vexaMeetingId: { eq: reservation } },
        { vexaMeetingId: '37', [key]: 'change' },
      ),
    ).toBeUndefined();
  });

  it.each([
    'zo-pending:other',
    'other',
    '9007199254740993',
    '-1',
    '1.5',
    '01',
    '',
  ])('rejects invalid promotion %s', (meetingId) => {
    expect(
      getCallReservationTransition(
        { id: { eq: id }, vexaMeetingId: { eq: reservation } },
        { vexaMeetingId: meetingId },
      ),
    ).toBeUndefined();
  });

  it('does not accept wildcard, missing or grouped-only ownership predicates', () => {
    for (const filter of [
      undefined,
      { id: { eq: id } },
      { vexaMeetingId: { eq: reservation } },
      { id: { eq: 'not-an-id' }, vexaMeetingId: { eq: reservation } },
      { id: { eq: id }, vexaMeetingId: { like: 'zo-pending:%' } },
      { or: [{ id: { eq: id } }, { vexaMeetingId: { eq: reservation } }] },
    ]) {
      expect(
        getCallReservationTransition(filter, { vexaMeetingId: null }),
      ).toBeUndefined();
    }
  });

  it('binds reservation parameters and scopes the exception to one exact Call even with caller OR filters', () => {
    const transition = getCallReservationTransition(
      { id: { eq: id }, vexaMeetingId: { eq: reservation } },
      { vexaMeetingId: '37' },
    );
    const fence = callReservationFence(object, context, escape, transition)!;
    expect(fence.condition).toContain(
      '"_call"."vexaMeetingId" = :zoCallReservationOwner AND "_call"."id" = :zoCallReservationId',
    );
    expect(fence.condition).not.toContain(reservation);
    expect(fence.parameters).toEqual({
      zoCallReservationPrefix: 'zo-pending:%',
      zoCallReservationOwner: reservation,
      zoCallReservationId: id,
    });
  });

  it('uses the selection alias only when explicitly requested', () => {
    expect(
      callReservationFence(object, context, escape, undefined, 'call')!
        .condition,
    ).toContain('"call"."vexaMeetingId"');
    expect(callReservationFence(object, context, escape)!.condition).toContain(
      '"_call"."vexaMeetingId"',
    );
  });
});

class MetadataDataSource extends DataSource {
  async prepareMetadata() {
    await this.buildMetadatas();
  }
}

describe('reservation predicates in real TypeORM SQL', () => {
  const entity = new EntitySchema({
    name: 'call',
    tableName: '_call',
    columns: {
      id: { type: 'uuid', primary: true },
      name: { type: 'text' },
      vexaMeetingId: { type: 'text', nullable: true },
      deletedAt: { type: 'timestamp', deleteDate: true, nullable: true },
    },
  });
  const source = new MetadataDataSource({
    type: 'postgres',
    entities: [entity],
  });
  beforeAll(async () => {
    await source.prepareMetadata();
  });

  it.each(['update', 'delete', 'softDelete', 'restore'] as const)(
    'keeps the fence in final %s SQL',
    (kind) => {
      const base = source.getRepository(entity).createQueryBuilder('_call');
      const builder =
        kind === 'update'
          ? base.update().set({ name: 'changed' })
          : kind === 'delete'
            ? base.delete()
            : kind === 'softDelete'
              ? base.softDelete()
              : base.restore();
      const fence = callReservationFence(object, context, (name) =>
        builder.escape(name),
      )!;
      builder
        .where('"_call"."id" = :id', { id })
        .orWhere('"_call"."name" = :other', { other: 'other' });
      appendCallReservationFence(builder, fence);
      const [sql, parameters] = builder.getQueryAndParameters();
      expect(sql).toContain(
        '"_call"."vexaMeetingId" IS NULL OR "_call"."vexaMeetingId" NOT LIKE',
      );
      expect(parameters).toContain('zo-pending:%');
      expect(sql).toMatch(/WHERE \(.* OR .*\) AND \(.*vexaMeetingId.*NOT LIKE/);
      expect(sql).not.toContain('"call".');
    },
  );

  it('ANDs the upsert guard with a grouped existing overwrite condition', () => {
    const builder = source
      .getRepository(entity)
      .createQueryBuilder()
      .insert()
      .values({ id, name: 'changed' })
      .orUpdate(['name'], ['id']);
    const fence = callReservationFence(object, context, (name) =>
      builder.escape(name),
    )!;
    builder.expressionMap.onUpdate.overwriteCondition = [
      {
        type: 'simple',
        condition: {
          operator: 'brackets',
          condition: [
            { type: 'simple', condition: '"_call"."name" = :left' },
            { type: 'or', condition: '"_call"."name" = :right' },
          ],
        },
      },
      { type: 'and', condition: fence.condition },
    ];
    builder.setParameters({ left: 'one', right: 'two', ...fence.parameters });
    const [sql, parameters] = builder.getQueryAndParameters();
    expect(sql).toMatch(/WHERE \(.* OR .*\) AND \(.*vexaMeetingId.*NOT LIKE/);
    expect(parameters).toContain('zo-pending:%');
  });
});
