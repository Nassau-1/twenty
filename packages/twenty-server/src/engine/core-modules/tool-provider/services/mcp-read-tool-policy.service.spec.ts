import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';
import { McpReadToolPolicyService } from 'src/engine/core-modules/tool-provider/services/mcp-read-tool-policy.service';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';
import { WorkspaceManyOrAllFlatEntityMapsCacheService } from 'src/engine/metadata-modules/flat-entity/services/workspace-many-or-all-flat-entity-maps-cache.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const applicationId = '22222222-2222-4222-8222-222222222222';
const logicFunctionId = '33333333-3333-4333-8333-333333333333';

const context = { workspaceId, roleId: 'role-id', rolePermissionConfig: {} };

const databaseEntry = (operation: string): ToolIndexEntry =>
  ({
    name: `company_${operation}`,
    label: operation,
    description: operation,
    category: 'DATABASE' as ToolIndexEntry['category'],
    executionRef: {
      kind: 'database_crud',
      objectNameSingular: 'company',
      operation,
    },
  }) as ToolIndexEntry;

describe('McpReadToolPolicyService', () => {
  const resourceService = {
    isEnrolledApplication: jest.fn(),
    approvedZoReadFunction: jest.fn(),
  } as unknown as jest.Mocked<McpReadClientResourceService>;
  const maps = {
    getOrRecomputeManyOrAllFlatEntityMaps: jest.fn(),
  } as unknown as jest.Mocked<WorkspaceManyOrAllFlatEntityMapsCacheService>;
  const service = new McpReadToolPolicyService(resourceService, maps);

  beforeEach(() => jest.clearAllMocks());

  it('admits only the three database read operation descriptors', async () => {
    await expect(
      service.isDescriptorAllowed(databaseEntry('find_many'), context),
    ).resolves.toBe(true);
    await expect(
      service.isDescriptorAllowed(databaseEntry('find_one'), context),
    ).resolves.toBe(true);
    await expect(
      service.isDescriptorAllowed(databaseEntry('group_by'), context),
    ).resolves.toBe(true);
    await expect(
      service.isDescriptorAllowed(databaseEntry('update'), context),
    ).resolves.toBe(false);
  });

  it('requires the exact current function id, owning application, and checksum', async () => {
    resourceService.approvedZoReadFunction.mockReturnValue({
      workspaceId,
      applicationId,
      logicFunctionId,
      checksum: 'a'.repeat(32),
    });
    maps.getOrRecomputeManyOrAllFlatEntityMaps.mockResolvedValue({
      flatLogicFunctionMaps: {
        byId: {
          [logicFunctionId]: {
            id: logicFunctionId,
            applicationId,
            checksum: 'a'.repeat(32),
            deletedAt: null,
          },
        },
      },
    } as never);
    const entry = {
      name: 'app_zo_read',
      label: 'Zo read',
      description: 'Zo read',
      category: 'LOGIC_FUNCTION' as ToolIndexEntry['category'],
      executionRef: { kind: 'logic_function', logicFunctionId },
    } as ToolIndexEntry;

    await expect(service.isDescriptorAllowed(entry, context)).resolves.toBe(
      true,
    );

    maps.getOrRecomputeManyOrAllFlatEntityMaps.mockResolvedValue({
      flatLogicFunctionMaps: {
        byId: {
          [logicFunctionId]: {
            id: logicFunctionId,
            applicationId: '44444444-4444-4444-8444-444444444444',
            checksum: 'a'.repeat(32),
            deletedAt: null,
          },
        },
      },
    } as never);

    await expect(service.isDescriptorAllowed(entry, context)).resolves.toBe(
      false,
    );
  });
});
