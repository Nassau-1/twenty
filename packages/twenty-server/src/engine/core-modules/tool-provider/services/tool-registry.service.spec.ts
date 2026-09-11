jest.mock(
  'src/engine/core-modules/tool-provider/services/tool-executor.service',
  () => ({ ToolExecutorService: class ToolExecutorService {} }),
);

import { ToolRegistryService } from 'src/engine/core-modules/tool-provider/services/tool-registry.service';
import { type ToolIndexEntry } from 'src/engine/core-modules/tool-provider/types/tool-index-entry.type';

const entry = {
  name: 'company_update',
  label: 'Update company',
  description: 'Update company',
  category: 'DATABASE' as ToolIndexEntry['category'],
  executionRef: {
    kind: 'database_crud',
    objectNameSingular: 'company',
    operation: 'update',
  },
} as ToolIndexEntry;

describe('ToolRegistryService descriptor policy', () => {
  it('checks the fresh descriptor immediately before dispatch', async () => {
    const provider = {
      category: entry.category,
      isAvailable: jest.fn().mockResolvedValue(true),
      generateDescriptors: jest.fn().mockResolvedValue([entry]),
    };
    const executor = { dispatch: jest.fn() };
    const registry = new ToolRegistryService(
      [provider] as never,
      executor as never,
      {} as never,
    );

    const result = await registry.resolveAndExecute(
      entry.name,
      {},
      { workspaceId: 'workspace-id', roleId: 'role-id' },
      { isDescriptorAllowed: async () => false },
    );

    expect(result.success).toBe(false);
    expect(executor.dispatch).not.toHaveBeenCalled();
    expect(provider.generateDescriptors).toHaveBeenCalledTimes(1);
  });
});
