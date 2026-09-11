import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';
import { MCP_READ_TOKEN_RESOURCE } from 'src/engine/core-modules/auth/types/application-token-resource.type';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const applicationId = '22222222-2222-4222-8222-222222222222';
const functionId = '33333333-3333-4333-8333-333333333333';

const validConfig = JSON.stringify({
  enrolledApplications: [{ workspaceId, applicationId }],
  approvedZoReadFunction: {
    workspaceId,
    applicationId,
    logicFunctionId: functionId,
    checksum: 'a'.repeat(32),
  },
});

describe('McpReadClientResourceService', () => {
  const config = {
    get: jest.fn<unknown, [string]>(),
  } as unknown as jest.Mocked<TwentyConfigService>;
  const service = new McpReadClientResourceService(config);

  beforeEach(() => jest.clearAllMocks());

  it('derives mcp_read only for an exact server-enrolled application', () => {
    config.get.mockReturnValue(validConfig);

    expect(service.resourceFor({ workspaceId, applicationId })).toBe(
      MCP_READ_TOKEN_RESOURCE,
    );
    expect(
      service.resourceFor({
        workspaceId,
        applicationId: '44444444-4444-4444-8444-444444444444',
      }),
    ).toBeUndefined();
  });

  it.each([
    undefined,
    '{',
    JSON.stringify({
      enrolledApplications: [{ workspaceId, applicationId }],
      approvedZoReadFunction: {
        workspaceId,
        applicationId,
        logicFunctionId: functionId,
        checksum: 'not-a-checksum',
      },
    }),
    JSON.stringify({
      enrolledApplications: [
        { workspaceId, applicationId },
        { workspaceId, applicationId },
      ],
      approvedZoReadFunction: {
        workspaceId,
        applicationId,
        logicFunctionId: functionId,
        checksum: 'a'.repeat(32),
      },
    }),
  ])('fails closed for invalid server configuration', (value) => {
    config.get.mockReturnValue(value);

    expect(service.resourceFor({ workspaceId, applicationId })).toBeUndefined();
    expect(service.approvedZoReadFunction(workspaceId)).toBeUndefined();
  });

  it('returns only the exact current approved function binding', () => {
    config.get.mockReturnValue(validConfig);

    expect(service.approvedZoReadFunction(workspaceId)).toEqual({
      workspaceId,
      applicationId,
      logicFunctionId: functionId,
      checksum: 'a'.repeat(32),
    });
    expect(
      service.approvedZoReadFunction('44444444-4444-4444-8444-444444444444'),
    ).toBeUndefined();
  });
});
