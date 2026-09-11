import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { randomUUID } from 'crypto';

import { type Request } from 'express';
import { WorkspaceActivationStatus } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import { AppTokenEntity } from 'src/engine/core-modules/app-token/app-token.entity';
import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { JwtAuthStrategy } from 'src/engine/core-modules/auth/strategies/jwt.auth.strategy';
import { EmailService } from 'src/engine/core-modules/email/email.service';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';
import { MCP_READ_TOKEN_RESOURCE } from 'src/engine/core-modules/auth/types/application-token-resource.type';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';

import { AccessTokenService } from './access-token.service';

describe('AccessTokenService', () => {
  let service: AccessTokenService;
  let jwtWrapperService: JwtWrapperService;
  let twentyConfigService: TwentyConfigService;
  let userRepository: Repository<UserEntity>;
  let workspaceRepository: Repository<WorkspaceEntity>;
  let globalWorkspaceOrmManager: GlobalWorkspaceOrmManager;
  let userWorkspaceRepository: Repository<UserWorkspaceEntity>;
  let mcpReadClientResourceService: jest.Mocked<McpReadClientResourceService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccessTokenService,
        {
          provide: JwtWrapperService,
          useValue: {
            signAsyncOrThrow: jest.fn(),
            verifyJwtToken: jest.fn(),
            decode: jest.fn(),
            generateAppSecret: jest.fn(),
            extractJwtFromRequest: jest.fn(),
          },
        },
        {
          provide: JwtAuthStrategy,
          useValue: {
            validate: jest.fn(),
          },
        },
        {
          provide: TwentyConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(UserEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(AppTokenEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useClass: Repository,
        },
        {
          provide: getRepositoryToken(UserWorkspaceEntity),
          useClass: Repository,
        },
        {
          provide: EmailService,
          useValue: {},
        },
        {
          provide: GlobalWorkspaceOrmManager,
          useValue: {
            getRepository: jest.fn(),
            executeInWorkspaceContext: jest
              .fn()
              .mockImplementation((fn: () => any, _authContext?: any) => fn()),
          },
        },
        {
          provide: McpReadClientResourceService,
          useValue: {
            isEnrolledApplication: jest.fn().mockReturnValue(false),
          },
        },
      ],
    }).compile();

    service = module.get<AccessTokenService>(AccessTokenService);
    jwtWrapperService = module.get<JwtWrapperService>(JwtWrapperService);
    twentyConfigService = module.get<TwentyConfigService>(TwentyConfigService);
    userRepository = module.get<Repository<UserEntity>>(
      getRepositoryToken(UserEntity),
    );
    workspaceRepository = module.get<Repository<WorkspaceEntity>>(
      getRepositoryToken(WorkspaceEntity),
    );
    globalWorkspaceOrmManager = module.get<GlobalWorkspaceOrmManager>(
      GlobalWorkspaceOrmManager,
    );
    userWorkspaceRepository = module.get<Repository<UserWorkspaceEntity>>(
      getRepositoryToken(UserWorkspaceEntity),
    );
    mcpReadClientResourceService = module.get(McpReadClientResourceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateAccessToken', () => {
    it('should generate an access token successfully', async () => {
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const mockUser = {
        id: userId,
      };
      const mockWorkspace = {
        activationStatus: WorkspaceActivationStatus.ACTIVE,
        id: workspaceId,
      };
      const mockUserWorkspace = { id: randomUUID() };
      const mockWorkspaceMember = { id: randomUUID() };
      const mockToken = 'mock-token';

      jest.spyOn(twentyConfigService, 'get').mockReturnValue('1h');
      jest
        .spyOn(userRepository, 'findOne')
        .mockResolvedValue(mockUser as UserEntity);
      jest
        .spyOn(workspaceRepository, 'findOne')
        .mockResolvedValue(mockWorkspace as WorkspaceEntity);
      jest
        .spyOn(userWorkspaceRepository, 'findOne')
        .mockResolvedValue(mockUserWorkspace as UserWorkspaceEntity);
      jest.spyOn(globalWorkspaceOrmManager, 'getRepository').mockResolvedValue({
        findOne: jest.fn().mockResolvedValue(mockWorkspaceMember),
      } as any);
      jest
        .spyOn(jwtWrapperService, 'signAsyncOrThrow')
        .mockResolvedValue(mockToken);

      const result = await service.generateAccessToken({
        userId,
        workspaceId,
        authProvider: AuthProviderEnum.Password,
      });

      expect(result).toEqual({
        token: mockToken,
        expiresAt: expect.any(Date),
      });
      expect(jwtWrapperService.signAsyncOrThrow).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: userId,
          workspaceId: workspaceId,
          workspaceMemberId: mockWorkspaceMember.id,
        }),
        expect.any(Object),
      );
    });

    it('embeds impersonation claims when provided', async () => {
      const userId = randomUUID();
      const workspaceId = randomUUID();
      const impersonatorUserWorkspaceId = randomUUID();
      const impersonatedUserWorkspaceId = randomUUID();
      const mockUser = { id: userId } as UserEntity;
      const mockWorkspace = {
        activationStatus: WorkspaceActivationStatus.ACTIVE,
        id: workspaceId,
      } as WorkspaceEntity;
      const mockUserWorkspace = {
        id: impersonatedUserWorkspaceId,
      } as UserWorkspaceEntity;
      const mockWorkspaceMember = { id: randomUUID() };
      const mockToken = 'mock-token';

      jest.spyOn(twentyConfigService, 'get').mockReturnValue('1h');
      jest
        .spyOn(userRepository, 'findOne')
        .mockResolvedValue(mockUser as UserEntity);
      jest
        .spyOn(workspaceRepository, 'findOne')
        .mockResolvedValue(mockWorkspace as WorkspaceEntity);
      jest
        .spyOn(userWorkspaceRepository, 'findOne')
        .mockResolvedValueOnce(mockUserWorkspace as UserWorkspaceEntity)
        .mockResolvedValueOnce({
          id: impersonatorUserWorkspaceId,
          workspaceId,
        } as UserWorkspaceEntity)
        .mockResolvedValueOnce({
          id: impersonatedUserWorkspaceId,
          workspaceId,
        } as UserWorkspaceEntity);
      jest.spyOn(globalWorkspaceOrmManager, 'getRepository').mockResolvedValue({
        findOne: jest.fn().mockResolvedValue(mockWorkspaceMember),
      } as any);
      const signSpy = jest
        .spyOn(jwtWrapperService, 'signAsyncOrThrow')
        .mockResolvedValue(mockToken);

      await service.generateAccessToken({
        userId,
        workspaceId,
        authProvider: AuthProviderEnum.Impersonation,
        isImpersonating: true,
        impersonatorUserWorkspaceId: impersonatorUserWorkspaceId,
        impersonatedUserWorkspaceId: impersonatedUserWorkspaceId,
      });

      expect(signSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          isImpersonating: true,
          impersonatorUserWorkspaceId: impersonatorUserWorkspaceId,
          impersonatedUserWorkspaceId: impersonatedUserWorkspaceId,
        }),
        expect.any(Object),
      );
    });

    it('should throw an error if user is not found', async () => {
      jest.spyOn(twentyConfigService, 'get').mockReturnValue('1h');
      jest.spyOn(userRepository, 'findOne').mockResolvedValue(null);
      jest
        .spyOn(workspaceRepository, 'findOne')
        .mockResolvedValue({} as WorkspaceEntity);
      jest
        .spyOn(userWorkspaceRepository, 'findOne')
        .mockResolvedValue({} as UserWorkspaceEntity);

      await expect(
        service.generateAccessToken({
          userId: 'non-existent-user',
          workspaceId: 'workspace-id',
          authProvider: AuthProviderEnum.Password,
        }),
      ).rejects.toThrow(AuthException);
    });
  });

  describe('validateToken', () => {
    it('should validate a token successfully', async () => {
      const mockToken = 'valid-token';
      const mockRequest = {
        headers: {
          authorization: `Bearer ${mockToken}`,
        },
      } as Request;
      const mockDecodedToken = { sub: 'user-id', workspaceId: 'workspace-id' };
      const mockAuthContext = {
        user: { id: 'user-id' },
        apiKey: null,
        workspace: { id: 'workspace-id' },
        workspaceMemberId: 'workspace-member-id',
      };

      jest
        .spyOn(jwtWrapperService, 'extractJwtFromRequest')
        .mockReturnValue(() => mockToken);
      jest
        .spyOn(jwtWrapperService, 'verifyJwtToken')
        .mockResolvedValue(undefined);
      jest
        .spyOn(jwtWrapperService, 'decode')
        .mockReturnValue(mockDecodedToken as any);
      jest
        .spyOn(service['jwtStrategy'], 'validate')
        .mockReturnValue(mockAuthContext as any);

      const result = await service.validateTokenByRequest(mockRequest);

      expect(result).toEqual(mockAuthContext);
      expect(jwtWrapperService.verifyJwtToken).toHaveBeenCalledWith(mockToken);
      expect(jwtWrapperService.decode).toHaveBeenCalledWith(mockToken);
      expect(service['jwtStrategy'].validate).toHaveBeenCalledWith(
        mockDecodedToken,
      );
    });

    it('should throw an error if token is missing', async () => {
      const mockRequest = {
        headers: {},
      } as Request;

      jest
        .spyOn(jwtWrapperService, 'extractJwtFromRequest')
        .mockReturnValue(() => null);

      await expect(service.validateTokenByRequest(mockRequest)).rejects.toThrow(
        AuthException,
      );
    });

    it.each([
      ['GraphQL hydration', 'POST', '/graphql'],
      ['OpenAPI and route validation', 'GET', '/rest/companies'],
    ])(
      'rejects a marked MCP read application token during %s',
      async (_caller, method, path) => {
        const mockToken = 'marked-token';
        const mockAuthContext = {
          workspace: { id: 'workspace-id' },
          application: { id: 'application-id' },
          applicationTokenResource: MCP_READ_TOKEN_RESOURCE,
        };

        jest
          .spyOn(jwtWrapperService, 'extractJwtFromRequest')
          .mockReturnValue(() => mockToken);
        jest
          .spyOn(jwtWrapperService, 'verifyJwtToken')
          .mockResolvedValue(undefined);
        jest.spyOn(jwtWrapperService, 'decode').mockReturnValue({} as never);
        jest
          .spyOn(service['jwtStrategy'], 'validate')
          .mockResolvedValue(mockAuthContext as never);
        mcpReadClientResourceService.isEnrolledApplication.mockReturnValue(
          true,
        );

        await expect(
          service.validateTokenByRequest({ method, path } as Request),
        ).rejects.toMatchObject({ code: AuthExceptionCode.UNAUTHENTICATED });
      },
    );

    it.each(['/mcp', '/mcp/', '/MCP', '/MCP/'])(
      'permits a marked MCP read application token only on routed POST %s',
      async (path) => {
        const mockToken = 'marked-token';
        const mockAuthContext = {
          workspace: { id: 'workspace-id' },
          application: { id: 'application-id' },
          applicationTokenResource: MCP_READ_TOKEN_RESOURCE,
        };

        jest
          .spyOn(jwtWrapperService, 'extractJwtFromRequest')
          .mockReturnValue(() => mockToken);
        jest
          .spyOn(jwtWrapperService, 'verifyJwtToken')
          .mockResolvedValue(undefined);
        jest.spyOn(jwtWrapperService, 'decode').mockReturnValue({} as never);
        jest
          .spyOn(service['jwtStrategy'], 'validate')
          .mockResolvedValue(mockAuthContext as never);
        mcpReadClientResourceService.isEnrolledApplication.mockReturnValue(
          true,
        );

        await expect(
          service.validateTokenByRequest({ method: 'POST', path } as Request),
        ).resolves.toEqual(mockAuthContext);
      },
    );

    it.each(['/mcp//', '/mcp/search', '/mcp//search', '/mcp/other/'])(
      'rejects a marked MCP read token outside the routed MCP path: %s',
      async (path) => {
        const mockAuthContext = {
          workspace: { id: 'workspace-id' },
          application: { id: 'application-id' },
          applicationTokenResource: MCP_READ_TOKEN_RESOURCE,
        };

        jest
          .spyOn(jwtWrapperService, 'extractJwtFromRequest')
          .mockReturnValue(() => 'marked-token');
        jest
          .spyOn(jwtWrapperService, 'verifyJwtToken')
          .mockResolvedValue(undefined);
        jest.spyOn(jwtWrapperService, 'decode').mockReturnValue({} as never);
        jest
          .spyOn(service['jwtStrategy'], 'validate')
          .mockResolvedValue(mockAuthContext as never);
        mcpReadClientResourceService.isEnrolledApplication.mockReturnValue(
          true,
        );

        await expect(
          service.validateTokenByRequest({ method: 'POST', path } as Request),
        ).rejects.toMatchObject({ code: AuthExceptionCode.UNAUTHENTICATED });
      },
    );

    it.each([
      [
        'an old unmarked token for a newly enrolled application',
        undefined,
        true,
      ],
      [
        'a marked token after enrollment removal',
        MCP_READ_TOKEN_RESOURCE,
        false,
      ],
    ])(
      'rejects %s through shared request validation',
      async (_description, applicationTokenResource, isEnrolled) => {
        const mockToken = 'application-token';

        jest
          .spyOn(jwtWrapperService, 'extractJwtFromRequest')
          .mockReturnValue(() => mockToken);
        jest
          .spyOn(jwtWrapperService, 'verifyJwtToken')
          .mockResolvedValue(undefined);
        jest.spyOn(jwtWrapperService, 'decode').mockReturnValue({} as never);
        jest.spyOn(service['jwtStrategy'], 'validate').mockResolvedValue({
          workspace: { id: 'workspace-id' },
          application: { id: 'application-id' },
          ...(applicationTokenResource ? { applicationTokenResource } : {}),
        } as never);
        mcpReadClientResourceService.isEnrolledApplication.mockReturnValue(
          isEnrolled,
        );

        await expect(
          service.validateTokenByRequest({
            method: 'POST',
            path: '/mcp',
          } as Request),
        ).rejects.toMatchObject({ code: AuthExceptionCode.UNAUTHENTICATED });
      },
    );
  });
});
