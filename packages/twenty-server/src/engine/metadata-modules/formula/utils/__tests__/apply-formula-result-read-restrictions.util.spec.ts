import { type ObjectsPermissions } from 'twenty-shared/types';

import { applyFormulaResultReadRestrictions } from 'src/engine/metadata-modules/formula/utils/apply-formula-result-read-restrictions.util';

const createObjectPermissions = (): ObjectsPermissions => ({
  'object-id': {
    canReadObjectRecords: true,
    canUpdateObjectRecords: true,
    canSoftDeleteObjectRecords: true,
    canDestroyObjectRecords: true,
    restrictedFields: {},
    rowLevelPermissionPredicates: [],
    rowLevelPermissionPredicateGroups: [],
  },
});

const fields = [
  {
    id: 'source-id',
    objectMetadataId: 'object-id',
    universalIdentifier: 'source-uid',
  },
  {
    id: 'first-output-id',
    objectMetadataId: 'object-id',
    universalIdentifier: 'first-output-uid',
  },
  {
    id: 'second-output-id',
    objectMetadataId: 'object-id',
    universalIdentifier: 'second-output-uid',
  },
];

const definitions = [
  {
    id: 'first-definition-id',
    activeVersionId: 'first-version-id',
    objectMetadataId: 'object-id',
    outputFieldMetadataId: 'first-output-id',
    versions: [
      {
        id: 'first-version-id',
        dependencies: [
          {
            kind: 'FIELD' as const,
            fieldMetadataUniversalIdentifier: 'source-uid',
          },
        ],
      },
    ],
  },
  {
    id: 'second-definition-id',
    activeVersionId: 'second-version-id',
    objectMetadataId: 'object-id',
    outputFieldMetadataId: 'second-output-id',
    versions: [
      {
        id: 'second-version-id',
        dependencies: [
          {
            kind: 'FIELD' as const,
            fieldMetadataUniversalIdentifier: 'first-output-uid',
          },
        ],
      },
    ],
  },
];

describe('applyFormulaResultReadRestrictions', () => {
  it('keeps Formula outputs readable when the transitive dependency closure is readable', () => {
    const objectsPermissions = createObjectPermissions();

    expect(
      applyFormulaResultReadRestrictions({
        definitions,
        fields,
        objectsPermissions,
      }),
    ).toEqual([]);
    expect(
      objectsPermissions['object-id'].restrictedFields['second-output-id'],
    ).toBeUndefined();
  });

  it('redacts every downstream Formula when a transitive source is unreadable', () => {
    const objectsPermissions = createObjectPermissions();

    objectsPermissions['object-id'].restrictedFields['source-id'] = {
      canRead: false,
      canUpdate: false,
    };

    expect(
      applyFormulaResultReadRestrictions({
        definitions,
        fields,
        objectsPermissions,
      }),
    ).toEqual(['first-output-id', 'second-output-id']);
    expect(
      objectsPermissions['object-id'].restrictedFields['second-output-id'],
    ).toEqual({ canRead: false });
  });

  it('fails closed instead of representing unsupported paths as null', () => {
    const objectsPermissions = createObjectPermissions();
    const unsupportedDefinitions = [
      {
        ...definitions[0],
        versions: [
          {
            id: 'first-version-id',
            dependencies: [
              {
                kind: 'RELATION' as const,
                relationFieldMetadataUniversalIdentifier: 'relation-uid',
              },
            ],
          },
        ],
      },
    ];

    expect(
      applyFormulaResultReadRestrictions({
        definitions: unsupportedDefinitions,
        fields,
        objectsPermissions,
      }),
    ).toEqual(['first-output-id']);
    expect(
      objectsPermissions['object-id'].restrictedFields['first-output-id'],
    ).toEqual({ canRead: false });
  });
});
