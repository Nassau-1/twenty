import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';

import { isDefined } from 'twenty-shared/utils';

import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';
import { MCP_READ_TOKEN_RESOURCE } from 'src/engine/core-modules/auth/types/application-token-resource.type';
import { bindDataToRequestObject } from 'src/engine/utils/bind-data-to-request-object.util';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly workspaceStorageCacheService: WorkspaceCacheStorageService,
    private readonly mcpReadClientResourceService: McpReadClientResourceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();

    try {
      const data =
        await this.accessTokenService.validateTokenByRequest(request);
      const metadataVersion = data.workspace
        ? await this.workspaceStorageCacheService.getMetadataVersion(
            data.workspace.id,
          )
        : undefined;

      if (
        !isDefined(data.apiKey) &&
        !isDefined(data.userWorkspaceId) &&
        !isDefined(data.application)
      ) {
        this.logger.warn(
          `Auth failed: no apiKey, userWorkspaceId, or application in context`,
        );

        return false;
      }

      if (data.application && data.workspace) {
        const isEnrolled =
          this.mcpReadClientResourceService.isEnrolledApplication({
            workspaceId: data.workspace.id,
            applicationId: data.application.id,
          });
        const isMarked =
          data.applicationTokenResource === MCP_READ_TOKEN_RESOURCE;

        if (
          (isEnrolled && !isMarked) ||
          (isMarked && !isEnrolled) ||
          (isMarked && (request.method !== 'POST' || request.path !== '/mcp'))
        ) {
          return false;
        }
      }

      bindDataToRequestObject(data, request, metadataVersion);

      return true;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      this.logger.warn(`Auth failed: ${errorMessage}`);

      return false;
    }
  }
}
