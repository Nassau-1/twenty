import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';
import { McpReadToolPolicyService } from 'src/engine/core-modules/tool-provider/services/mcp-read-tool-policy.service';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';

const workspaceId = '11111111-1111-4111-8111-111111111111';

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
  } as unknown as jest.Mocked<McpReadClientResourceService>;
  const service = new McpReadToolPolicyService(resourceService);

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

  it('rejects logic-function descriptors, including formerly approved metadata', async () => {
    const entry = {
      name: 'app_zo_read',
      label: 'Zo read',
      description: 'Zo read',
      category: 'LOGIC_FUNCTION' as ToolIndexEntry['category'],
      executionRef: {
        kind: 'logic_function',
        logicFunctionId: '33333333-3333-4333-8333-333333333333',
      },
    } as ToolIndexEntry;

    await expect(service.isDescriptorAllowed(entry, context)).resolves.toBe(
      false,
    );
  });
});
