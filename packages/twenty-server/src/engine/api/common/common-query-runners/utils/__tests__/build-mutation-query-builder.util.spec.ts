import { DataSource, EntitySchema, type ObjectLiteral } from 'typeorm';
import { FieldMetadataType, RelationType } from 'twenty-shared/types';

import { buildMutationQueryBuilder } from 'src/engine/api/common/common-query-runners/utils/build-mutation-query-builder.util';
import { GraphqlQueryFilterConditionParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query-filter/graphql-query-filter-condition.parser';
import { type GraphqlQueryParser } from 'src/engine/api/graphql/graphql-query-runner/graphql-query-parsers/graphql-query.parser';
import { type ObjectRecordFilter } from 'src/engine/api/graphql/workspace-query-builder/interfaces/object-record.interface';
import { getFlatFieldMetadataMock } from 'src/engine/metadata-modules/flat-field-metadata/__mocks__/get-flat-field-metadata.mock';
import { getFlatObjectMetadataMock } from 'src/engine/metadata-modules/flat-object-metadata/__mocks__/get-flat-object-metadata.mock';
import { PermissionsException } from 'src/engine/metadata-modules/permissions/permissions.exception';
import { type WorkspaceRepository } from 'src/engine/twenty-orm/repository/workspace.repository';
import { type WorkspaceSelectQueryBuilder } from 'src/engine/twenty-orm/repository/workspace-select-query-builder';
import { applyRowLevelPermissionPredicates } from 'src/engine/twenty-orm/utils/apply-row-level-permission-predicates.util';
import { applyTableAliasOnWhereCondition } from 'src/engine/twenty-orm/utils/apply-table-alias-on-where-condition';

jest.mock(
  'src/engine/twenty-orm/utils/build-row-level-permission-record-filter.util',
  () => ({
    buildRowLevelPermissionRecordFilter: jest.fn(() => ({
      and: [
        { name: { eq: 'allowed-name' } },
        { not: { vexaMeetingId: { eq: 'excluded-meeting' } } },
      ],
    })),
  }),
);

class MetadataOnlyDataSource extends DataSource {
  async prepareMetadata() {
    await this.buildMetadatas();
  }
}

const callEntity = new EntitySchema<ObjectLiteral>({
  name: 'call',
  tableName: '_call',
  columns: {
    id: { type: 'uuid', primary: true },
    name: { type: 'text' },
    vexaMeetingId: { type: 'text', nullable: true },
    deletedAt: { type: 'timestamp', nullable: true, deleteDate: true },
  },
  relations: {
    company: { type: 'many-to-one', target: 'company', joinColumn: true },
  },
});

describe('buildMutationQueryBuilder physical target references', () => {
  let repository: WorkspaceRepository<ObjectLiteral>;
  const companyEntity = new EntitySchema({
    name: 'company',
    columns: {
      id: { type: 'uuid', primary: true },
      name: { type: 'text' },
    },
  });
  const fields = [
    ['id', FieldMetadataType.UUID],
    ['name', FieldMetadataType.TEXT],
    ['vexaMeetingId', FieldMetadataType.TEXT],
  ].map(([name, type]) =>
    getFlatFieldMetadataMock({
      id: `call-${name}`,
      universalIdentifier: `call-${name}`,
      objectMetadataId: 'call-object',
      name,
      type: type as FieldMetadataType,
    }),
  );
  fields.push(
    getFlatFieldMetadataMock({
      id: 'call-company',
      universalIdentifier: 'call-company',
      objectMetadataId: 'call-object',
      name: 'company',
      type: FieldMetadataType.RELATION,
      relationTargetObjectMetadataId: 'company-object',
      settings: {
        relationType: RelationType.MANY_TO_ONE,
        joinColumnName: 'companyId',
      },
    }),
  );
  const callMetadata = getFlatObjectMetadataMock({
    id: 'call-object',
    universalIdentifier: 'call-object',
    nameSingular: 'call',
    fieldIds: fields.map(({ id }) => id),
  });
  fields.push(
    getFlatFieldMetadataMock({
      id: 'company-name',
      universalIdentifier: 'company-name',
      objectMetadataId: 'company-object',
      name: 'name',
      type: FieldMetadataType.TEXT,
    }),
  );
  const companyMetadata = getFlatObjectMetadataMock({
    id: 'company-object',
    universalIdentifier: 'company-object',
    nameSingular: 'company',
    fieldIds: ['company-name'],
  });
  const flatFieldMetadataMaps = {
    byUniversalIdentifier: Object.fromEntries(
      fields.map((field) => [field.id, field]),
    ),
    universalIdentifierById: Object.fromEntries(
      fields.map(({ id }) => [id, id]),
    ),
    universalIdentifiersByApplicationId: {},
  } as ConstructorParameters<typeof GraphqlQueryFilterConditionParser>[1];
  const parser = new GraphqlQueryFilterConditionParser(
    callMetadata,
    flatFieldMetadataMaps,
    {
      byUniversalIdentifier: {
        'call-object': callMetadata,
        'company-object': companyMetadata,
      },
      universalIdentifierById: {
        'call-object': 'call-object',
        'company-object': 'company-object',
      },
      universalIdentifiersByApplicationId: {},
    } as ConstructorParameters<typeof GraphqlQueryFilterConditionParser>[2],
  );

  const buildGraphqlFilter = (
    filter: Partial<ObjectRecordFilter>,
    permissions: WorkspaceSelectQueryBuilder<ObjectLiteral>['objectRecordsPermissions'] = {},
  ) =>
    buildMutationQueryBuilder({
      repository,
      filter,
      commonQueryParser: {
        applyFilterToBuilder: (
          builder: WorkspaceSelectQueryBuilder<ObjectLiteral>,
          alias: string,
          value: Partial<ObjectRecordFilter>,
        ) => {
          builder.objectRecordsPermissions = permissions;

          return parser.parse(builder, alias, value);
        },
      } as unknown as GraphqlQueryParser,
    });

  beforeAll(async () => {
    const source = new MetadataOnlyDataSource({
      type: 'postgres',
      entities: [callEntity, companyEntity],
    });

    await source.prepareMetadata();
    repository = source.getRepository(
      callEntity,
    ) as WorkspaceRepository<ObjectLiteral>;
  });

  const build = (condition: (alias: string) => string) => {
    const commonQueryParser = {
      applyFilterToBuilder: (
        builder: WorkspaceSelectQueryBuilder<ObjectLiteral>,
        alias: string,
      ) =>
        builder.where(condition(alias), {
          id: 'fixture-id',
          value: 'call.id',
          excluded: 'literal-call',
        }),
    } as unknown as GraphqlQueryParser;

    return buildMutationQueryBuilder({
      repository,
      filter: {},
      commonQueryParser,
    });
  };

  it.each([
    [
      'flat',
      (alias: string) =>
        `"${alias}"."id" = :id AND "${alias}"."vexaMeetingId" IS NULL`,
    ],
    [
      'nested AND/OR/NOT',
      (alias: string) =>
        `("${alias}"."id" = :id AND ("${alias}"."vexaMeetingId" IS NULL OR "${alias}"."vexaMeetingId" = :value)) AND NOT ("${alias}"."name" = :excluded)`,
    ],
  ])('keeps %s predicates on the SQL mutation target', (_name, condition) => {
    const builder = build(condition as (alias: string) => string);

    expect(builder.alias).toBe('_call');
    for (const mutation of [
      builder.clone().update().set({ vexaMeetingId: 'new' }),
      builder.clone().delete(),
      builder.clone().softDelete(),
      builder.clone().restore(),
    ]) {
      const query = mutation.getQuery();

      expect(query).toContain('"_call"."id" = :id');
      expect(query).toContain('"_call"."vexaMeetingId"');
      expect(query).not.toContain('"call".');
      expect(mutation.getParameters()).toMatchObject({
        id: 'fixture-id',
        value: 'call.id',
        excluded: 'literal-call',
      });
    }
  });

  it('does not rewrite literals, bind values or a nested subquery alias', () => {
    const builder = build(
      (alias) =>
        `"${alias}"."id" = :id AND "${alias}"."name" = 'call.name' AND EXISTS (SELECT 1 FROM "_call" AS "call" WHERE "call"."name" = :value)`,
    );
    const before = structuredClone(builder.expressionMap.wheres);

    const result = applyTableAliasOnWhereCondition({
      condition: builder.expressionMap.wheres,
      tableName: repository.metadata.tableName,
      aliasName: builder.alias,
    });

    expect(builder.alias).toBe('_call');
    expect(result).toEqual(before);
    expect(builder.getParameters().value).toBe('call.id');
  });

  it('keeps real GraphQL nested predicates on the outer mutation for atomic rechecks', () => {
    const builder = buildGraphqlFilter({
      and: [
        { id: { eq: 'a0182b00-d0ef-4000-8000-000000000001' } },
        {
          or: [
            { vexaMeetingId: { is: 'NULL' } },
            { vexaMeetingId: { eq: 'call.id' } },
          ],
        },
        { not: { name: { eq: 'call.name' } } },
      ],
    });
    const before = structuredClone(builder.expressionMap.wheres);
    const query = builder
      .clone()
      .update()
      .set({ vexaMeetingId: 'new' })
      .getQuery();

    expect(query).toContain('"_call"."id"');
    expect(query).toContain('"_call"."vexaMeetingId" IS NULL');
    expect(query).toContain(' OR ');
    expect(query).toContain('NOT(');
    expect(query).not.toContain('SELECT');
    expect(query).not.toContain('"call".');
    expect(Object.values(builder.getParameters())).toEqual(
      expect.arrayContaining(['call.id', 'call.name']),
    );
    expect(
      applyTableAliasOnWhereCondition({
        condition: before,
        aliasName: builder.alias,
        tableName: repository.metadata.tableName,
      }),
    ).toEqual(before);
  });

  it('retains a self-contained relation subquery, including for restore', () => {
    const builder = buildGraphqlFilter({
      company: { name: { eq: 'call.id' } },
    });

    for (const mutation of [
      builder.clone().update().set({ name: 'new' }),
      builder.clone().delete(),
      builder.clone().softDelete(),
      builder.clone().restore(),
    ]) {
      const query = mutation.getQuery();

      expect(query).toContain('"_call"."id" IN (SELECT');
      expect(query).toContain('LEFT JOIN "company" "company"');
      expect(query).toContain('"company"."name"');
      expect(query).not.toContain('"_call"."deletedAt" IS NULL');
      expect(Object.values(mutation.getParameters())).toContain('call.id');
    }
  });

  it('isolates later parameterized RLS predicates from the event readback', () => {
    const builder = buildGraphqlFilter({ name: { eq: 'visible' } });
    const eventReadback = builder.clone();

    // computeEventSelectQueryBuilder shares conditions but copies parameters.
    eventReadback.expressionMap.wheres = builder.expressionMap.wheres;
    builder.expressionMap.wheres = applyTableAliasOnWhereCondition({
      condition: builder.expressionMap.wheres,
      aliasName: builder.alias,
      tableName: repository.metadata.tableName,
    }) as typeof builder.expressionMap.wheres;
    builder.andWhere('"_call"."id" = :rls_owner', { rls_owner: 'allowed-id' });

    expect(builder.getQuery()).toContain(':rls_owner');
    expect(builder.getParameters().rls_owner).toBe('allowed-id');
    expect(eventReadback.getParameters()).not.toHaveProperty('rls_owner');
    expect(eventReadback.getQuery()).not.toContain(':rls_owner');
  });

  it.each(['update', 'delete', 'softDelete', 'restore'] as const)(
    'emits direct RLS column references for %s on the physical target',
    (kind) => {
      const builder = buildGraphqlFilter({ id: { eq: 'fixture-id' } });
      const mutation =
        kind === 'update'
          ? builder.update().set({ name: 'allowed-name' })
          : builder[kind]();
      const queryBuilder = Object.assign(mutation, {
        objectRecordsPermissions: {},
      }) as unknown as WorkspaceSelectQueryBuilder<ObjectLiteral>;

      applyRowLevelPermissionPredicates({
        queryBuilder,
        objectMetadata: callMetadata,
        internalContext: {
          flatFieldMetadataMaps,
          userWorkspaceRoleMap: {},
          apiKeyRoleMap: { 'fixture-key': 'fixture-role' },
        } as unknown as Parameters<
          typeof applyRowLevelPermissionPredicates
        >[0]['internalContext'],
        authContext: {
          type: 'apiKey',
          apiKey: { id: 'fixture-key' },
        } as Parameters<
          typeof applyRowLevelPermissionPredicates
        >[0]['authContext'],
        featureFlagMap: {} as Parameters<
          typeof applyRowLevelPermissionPredicates
        >[0]['featureFlagMap'],
      });
      const query = mutation.getQuery();

      expect(query).toContain('"name" = :');
      expect(query).toContain('"vexaMeetingId" = :');
      expect(query).not.toContain('"call".');
      expect(Object.values(mutation.getParameters())).toEqual(
        expect.arrayContaining(['allowed-name', 'excluded-meeting']),
      );
    },
  );

  it.each([
    { canReadObjectRecords: false, restrictedFields: {} },
    {
      canReadObjectRecords: true,
      restrictedFields: { 'call-name': { canRead: false } },
    },
  ])(
    'still rejects unauthorized filter fields with physical aliases',
    (permission) => {
      expect(() =>
        buildGraphqlFilter({ name: { eq: 'private' } }, {
          'call-object': permission,
        } as unknown as WorkspaceSelectQueryBuilder<ObjectLiteral>['objectRecordsPermissions']),
      ).toThrow(PermissionsException);
    },
  );
});
