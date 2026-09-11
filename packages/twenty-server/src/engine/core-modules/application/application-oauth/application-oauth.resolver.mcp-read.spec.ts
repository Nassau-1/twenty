import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { ApplicationTokenService } from 'src/engine/core-modules/auth/token/services/application-token.service';
import { ThrottlerService } from 'src/engine/core-modules/throttler/throttler.service';

import { ApplicationOAuthResolver } from './application-oauth.resolver';

describe('ApplicationOAuthResolver mcp_read issuance', () => {
  it('propagates service rejection when a settings/API-key context has no user binding', async () => {
    const applicationTokenService = {
      generateApplicationTokenPair: jest
        .fn()
        .mockRejectedValue(
          new AuthException(
            'MCP read application tokens require a user workspace binding',
            AuthExceptionCode.UNAUTHENTICATED,
          ),
        ),
    } as unknown as jest.Mocked<ApplicationTokenService>;
    const throttlerService = {
      tokenBucketThrottleOrThrow: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<ThrottlerService>;
    const resolver = new ApplicationOAuthResolver(
      applicationTokenService,
      throttlerService,
    );

    await expect(
      resolver.generateApplicationToken({ applicationId: 'application-id' }, {
        id: 'workspace-id',
      } as never),
    ).rejects.toMatchObject({ code: AuthExceptionCode.UNAUTHENTICATED });

    expect(
      applicationTokenService.generateApplicationTokenPair,
    ).toHaveBeenCalledWith({
      workspaceId: 'workspace-id',
      applicationId: 'application-id',
      userId: undefined,
      userWorkspaceId: undefined,
    });
  });
});
