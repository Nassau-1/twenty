import { ForbiddenException, Injectable } from '@nestjs/common';

import { isSystemAuthContext } from 'src/engine/core-modules/auth/guards/is-system-auth-context.guard';
import { getWorkspaceAuthContext } from 'src/engine/core-modules/auth/storage/workspace-auth-context.storage';
import { getObjectsPermissionsFromRolePermissionConfig } from 'src/engine/twenty-orm/utils/get-objects-permissions-from-role-permission-config.util';
import { resolveRolePermissionConfig } from 'src/engine/twenty-orm/utils/resolve-role-permission-config.util';
import { WorkspaceCacheService } from 'src/engine/workspace-cache/services/workspace-cache.service';

@Injectable()
export class FormulaAuthorizationService {
  constructor(private readonly workspaceCacheService: WorkspaceCacheService) {}

  async assertCanReadDependencies({
    workspaceId,
    objectMetadataId,
    dependencyFieldMetadataIds,
    dependencyObjectMetadataIds = [],
  }: {
    workspaceId: string;
    objectMetadataId: string;
    dependencyFieldMetadataIds: string[];
    dependencyObjectMetadataIds?: string[];
  }): Promise<void> {
    const authContext = getWorkspaceAuthContext();

    if (authContext.workspace.id !== workspaceId) {
      throw this.permissionDenied();
    }

    if (isSystemAuthContext(authContext)) {
      return;
    }

    const { apiKeyRoleMap, rolesPermissions, userWorkspaceRoleMap } =
      await this.workspaceCacheService.getOrRecompute(workspaceId, [
        'apiKeyRoleMap',
        'rolesPermissions',
        'userWorkspaceRoleMap',
      ]);
    const rolePermissionConfig = resolveRolePermissionConfig({
      authContext,
      apiKeyRoleMap,
      userWorkspaceRoleMap,
    });

    if (rolePermissionConfig === null) {
      throw this.permissionDenied();
    }

    const objectsPermissions = getObjectsPermissionsFromRolePermissionConfig({
      rolePermissionConfig,
      rolesPermissions,
    });
    const objectPermissions = objectsPermissions[objectMetadataId];

    if (objectPermissions?.canReadObjectRecords !== true) {
      throw this.permissionDenied();
    }

    for (const dependencyObjectMetadataId of new Set(
      dependencyObjectMetadataIds,
    )) {
      const dependencyObjectPermissions =
        objectsPermissions[dependencyObjectMetadataId];

      if (
        dependencyObjectPermissions?.canReadObjectRecords !== true ||
        dependencyObjectPermissions.rowLevelPermissionPredicates.length > 0 ||
        dependencyObjectPermissions.rowLevelPermissionPredicateGroups.length > 0
      ) {
        throw this.permissionDenied();
      }
    }

    for (const fieldMetadataId of new Set(dependencyFieldMetadataIds)) {
      if (
        objectPermissions.restrictedFields[fieldMetadataId]?.canRead === false
      ) {
        throw this.permissionDenied();
      }
    }
  }

  private permissionDenied(): ForbiddenException {
    return new ForbiddenException('Formula dependency is not authorized.');
  }
}
