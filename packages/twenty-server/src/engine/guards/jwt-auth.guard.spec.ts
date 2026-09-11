import { JwtAuthGuard } from 'src/engine/guards/jwt-auth.guard';
import { AccessTokenService } from 'src/engine/core-modules/auth/token/services/access-token.service';
import { MCP_READ_TOKEN_RESOURCE } from 'src/engine/core-modules/auth/types/application-token-resource.type';
import { WorkspaceCacheStorageService } from 'src/engine/workspace-cache-storage/workspace-cache-storage.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const applicationId = '22222222-2222-4222-8222-222222222222';

describe('JwtAuthGuard mcp_read application resource', () => {
  const accessTokenService = {
    validateTokenByRequest: jest.fn(),
  } as unknown as jest.Mocked<AccessTokenService>;
  const workspaceCacheStorageService = {
    getMetadataVersion: jest.fn(),
  } as unknown as jest.Mocked<WorkspaceCacheStorageService>;
  const guard = new JwtAuthGuard(
    accessTokenService,
    workspaceCacheStorageService,
  );

  const request = (method: string, path: string) => ({
    method,
    path,
    headers: {},
  });
  const executionContext = (value: object) =>
    ({
      switchToHttp: () => ({ getRequest: () => value }),
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    workspaceCacheStorageService.getMetadataVersion.mockResolvedValue(1);
    accessTokenService.validateTokenByRequest.mockResolvedValue({
      workspace: { id: workspaceId },
      application: { id: applicationId },
      applicationTokenResource: MCP_READ_TOKEN_RESOURCE,
    });
  });

  it('permits an enrolled marked application bearer only on POST /mcp', async () => {
    await expect(
      guard.canActivate(executionContext(request('POST', '/mcp'))),
    ).resolves.toBe(true);
  });

  it('relies on shared request validation for rejected resource requests', async () => {
    accessTokenService.validateTokenByRequest.mockRejectedValue(new Error());

    await expect(
      guard.canActivate(executionContext(request('GET', '/mcp'))),
    ).resolves.toBe(false);
  });

  it('leaves ordinary UI access contexts unchanged', async () => {
    accessTokenService.validateTokenByRequest.mockResolvedValue({
      workspace: { id: workspaceId },
      userWorkspaceId: 'user-workspace-id',
    });

    await expect(
      guard.canActivate(executionContext(request('POST', '/rest/companies'))),
    ).resolves.toBe(true);
  });
});
