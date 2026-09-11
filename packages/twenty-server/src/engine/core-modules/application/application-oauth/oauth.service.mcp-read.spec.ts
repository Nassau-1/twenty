jest.mock(
  'src/engine/core-modules/application/application-install/application-install.service',
  () => ({ ApplicationInstallService: class ApplicationInstallService {} }),
);

import { OAuthService } from 'src/engine/core-modules/application/application-oauth/oauth.service';
import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';

describe('OAuthService mcp_read client credentials grant', () => {
  it('rejects a server-enrolled client before issuing a workspace-only token', async () => {
    const resourceService = {
      isEnrolledApplication: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<McpReadClientResourceService>;
    const service = new OAuthService(
      {} as never,
      {
        find: jest.fn().mockResolvedValue([
          {
            id: '22222222-2222-4222-8222-222222222222',
            workspaceId: '11111111-1111-4111-8111-111111111111',
          },
        ]),
      } as never,
      {} as never,
      {} as never,
      {
        verifyClientSecret: jest.fn().mockResolvedValue(true),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      resourceService,
    );
    jest.spyOn(service as never, 'validateClient').mockResolvedValue({
      id: 'registration-id',
    });

    await expect(
      service.clientCredentialsGrant({
        clientId: 'client',
        clientSecret: 'secret',
      }),
    ).resolves.toEqual({
      error: 'unauthorized_client',
      error_description: 'This client requires an authorization-code grant',
    });
  });
});
