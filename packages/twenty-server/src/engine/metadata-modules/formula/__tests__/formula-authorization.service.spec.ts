import { ForbiddenException } from '@nestjs/common';

import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';
import { withWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { FormulaAuthorizationService } from 'src/engine/metadata-modules/formula/formula-authorization.service';
import { type WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

const workspace = { id: 'workspace-id' };
const readableObjectPermissions = {
  canReadObjectRecords: true,
  canUpdateObjectRecords: true,
  canSoftDeleteObjectRecords: true,
  canDestroyObjectRecords: true,
  restrictedFields: {},
  rowLevelPermissionPredicates: [],
  rowLevelPermissionPredicateGroups: [],
};

describe('FormulaAuthorizationService', () => {
  const workspaceCacheService = {
    getOrRecompute: jest.fn(),
  };
  const service = new FormulaAuthorizationService(
    workspaceCacheService as unknown as WorkspaceCacheService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      apiKeyRoleMap: { 'api-key-id': 'role-id' },
      rolesPermissions: {
        'role-id': { 'object-id': readableObjectPermissions },
      },
      userWorkspaceRoleMap: { 'user-workspace-id': 'role-id' },
    });
  });

  const runAs = (
    authContext: WorkspaceAuthContext,
    dependencyFieldMetadataIds = ['source-field-id'],
    dependencyObjectMetadataIds: string[] = [],
  ) =>
    withWorkspaceAuthContext(authContext, () =>
      service.assertCanReadDependencies({
        workspaceId: 'workspace-id',
        objectMetadataId: 'object-id',
        dependencyFieldMetadataIds,
        dependencyObjectMetadataIds,
      }),
    );

  it('authorizes readable dependencies for a user role', async () => {
    await expect(
      runAs({
        type: 'user',
        workspace,
        userWorkspaceId: 'user-workspace-id',
      } as WorkspaceAuthContext),
    ).resolves.toBeUndefined();
  });

  it('authorizes readable dependencies for an API key role', async () => {
    await expect(
      runAs({
        type: 'apiKey',
        workspace,
        apiKey: { id: 'api-key-id' },
      } as WorkspaceAuthContext),
    ).resolves.toBeUndefined();
  });

  it('rejects an unreadable dependency without naming it', async () => {
    workspaceCacheService.getOrRecompute.mockResolvedValue({
      apiKeyRoleMap: {},
      rolesPermissions: {
        'role-id': {
          'object-id': {
            ...readableObjectPermissions,
            restrictedFields: {
              'source-field-id': { canRead: false, canUpdate: false },
            },
          },
        },
      },
      userWorkspaceRoleMap: { 'user-workspace-id': 'role-id' },
    });

    await expect(
      runAs({
        type: 'user',
        workspace,
        userWorkspaceId: 'user-workspace-id',
      } as WorkspaceAuthContext),
    ).rejects.toEqual(
      new ForbiddenException('Formula dependency is not authorized.'),
    );
  });

  it('rejects a relation whose target object is unreadable', async () => {
    await expect(
      runAs(
        {
          type: 'user',
          workspace,
          userWorkspaceId: 'user-workspace-id',
        } as WorkspaceAuthContext,
        ['source-field-id'],
        ['person-object-id'],
      ),
    ).rejects.toEqual(
      new ForbiddenException('Formula dependency is not authorized.'),
    );
  });

  it('authorizes an unrestricted relation target and rejects row-filtered targets', async () => {
    const authContext = {
      type: 'user',
      workspace,
      userWorkspaceId: 'user-workspace-id',
    } as WorkspaceAuthContext;

    workspaceCacheService.getOrRecompute.mockResolvedValue({
      apiKeyRoleMap: {},
      rolesPermissions: {
        'role-id': {
          'object-id': readableObjectPermissions,
          'person-object-id': {
            ...readableObjectPermissions,
            restrictedFields: {},
          },
        },
      },
      userWorkspaceRoleMap: { 'user-workspace-id': 'role-id' },
    });
    await expect(
      runAs(authContext, ['source-field-id'], ['person-object-id']),
    ).resolves.toBeUndefined();

    workspaceCacheService.getOrRecompute.mockResolvedValue({
      apiKeyRoleMap: {},
      rolesPermissions: {
        'role-id': {
          'object-id': readableObjectPermissions,
          'person-object-id': {
            ...readableObjectPermissions,
            restrictedFields: {},
            rowLevelPermissionPredicates: [{ id: 'predicate-id' }],
          },
        },
      },
      userWorkspaceRoleMap: { 'user-workspace-id': 'role-id' },
    });
    await expect(
      runAs(authContext, ['source-field-id'], ['person-object-id']),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a cross-workspace request before loading permissions', async () => {
    await expect(
      runAs({
        type: 'user',
        workspace: { id: 'other-workspace-id' },
        userWorkspaceId: 'user-workspace-id',
      } as WorkspaceAuthContext),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(workspaceCacheService.getOrRecompute).not.toHaveBeenCalled();
  });
});
