import { Injectable } from '@nestjs/common';

import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';

const READ_DATABASE_OPERATIONS = new Set(['find_many', 'find_one', 'group_by']);

@Injectable()
export class McpReadToolPolicyService {
  constructor(
    private readonly mcpReadClientResourceService: McpReadClientResourceService,
  ) {}

  isMcpReadClient(
    workspaceId: string,
    application: FlatApplication | undefined,
  ): boolean {
    return (
      application !== undefined &&
      this.mcpReadClientResourceService.isEnrolledApplication({
        workspaceId,
        applicationId: application.id,
      })
    );
  }

  async isDescriptorAllowed(
    entry: ToolIndexEntry,
    _context: Pick<ToolProviderContext, 'workspaceId'>,
  ): Promise<boolean> {
    return (
      entry.executionRef.kind === 'database_crud' &&
      READ_DATABASE_OPERATIONS.has(entry.executionRef.operation)
    );
  }
}
