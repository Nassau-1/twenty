import { Injectable } from '@nestjs/common';

import { type FlatApplication } from 'src/engine/core-modules/application/types/flat-application.type';
import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';
import { type ToolProviderContext } from 'src/engine/core-modules/tool-provider/interfaces/tool-provider-context.type';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';

const READ_DATABASE_OPERATIONS = new Set(['find_many', 'find_one', 'group_by']);

@Injectable()
export class McpReadToolPolicyService {
  constructor(
    private readonly mcpReadClientResourceService: McpReadClientResourceService,
    private readonly flatEntityMapsCacheService: WorkspaceManyOrAllFlatEntityMapsCacheService,
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
    context: Pick<ToolProviderContext, 'workspaceId'>,
  ): Promise<boolean> {
    if (entry.executionRef.kind === 'database_crud') {
      return READ_DATABASE_OPERATIONS.has(entry.executionRef.operation);
    }

    if (entry.executionRef.kind !== 'logic_function') {
      return false;
    }

    const approved = this.mcpReadClientResourceService.approvedZoReadFunction(
      context.workspaceId,
    );

    if (approved?.logicFunctionId !== entry.executionRef.logicFunctionId) {
      return false;
    }

    const { flatLogicFunctionMaps } =
      await this.flatEntityMapsCacheService.getOrRecomputeManyOrAllFlatEntityMaps(
        {
          workspaceId: context.workspaceId,
          flatMapsKeys: ['flatLogicFunctionMaps'],
        },
      );
    const logicFunction = flatLogicFunctionMaps.byId[approved.logicFunctionId];

    return (
      logicFunction?.deletedAt === null &&
      logicFunction.applicationId === approved.applicationId &&
      logicFunction.checksum === approved.checksum
    );
  }
}
