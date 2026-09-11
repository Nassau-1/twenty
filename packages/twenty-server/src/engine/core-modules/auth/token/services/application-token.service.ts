import { InjectRepository } from '@nestjs/typeorm';
import { Inject, Injectable } from '@nestjs/common';

import { type Repository } from 'typeorm';
import { addMilliseconds } from 'date-fns';
import { assertIsDefinedOrThrow } from 'twenty-shared/utils';
import ms from 'ms';

import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type ApplicationAccessTokenJwtPayload } from 'src/engine/core-modules/auth/types/application-access-token-jwt-payload.type';
import { type ApplicationRefreshTokenJwtPayload } from 'src/engine/core-modules/auth/types/application-refresh-token-jwt-payload.type';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { type AuthToken } from 'src/engine/core-modules/auth/dto/auth-token.dto';
import { WorkspaceNotFoundDefaultError } from 'src/engine/core-modules/workspace/workspace.exception';
import { ApplicationEntity } from 'src/engine/core-modules/application/application.entity';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import {
  ApplicationException,
  ApplicationExceptionCode,
} from 'src/engine/core-modules/application/application.exception';
import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  MCP_READ_TOKEN_RESOURCE,
  ZO_DOCUMENT_SEARCH_TOKEN_RESOURCE,
  type ApplicationTokenResource,
} from 'src/engine/core-modules/auth/types/application-token-resource.type';
import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';

const APPLICATION_REFRESH_TOKEN_INVALID_OR_EXPIRED_MESSAGE =
  'Application refresh token invalid or expired';

@Injectable()
export class ApplicationTokenService {
  constructor(
    @Inject(JwtWrapperService)
    private readonly jwtWrapperService: JwtWrapperService,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(ApplicationEntity)
    private readonly applicationRepository: Repository<ApplicationEntity>,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    private readonly twentyConfigService: TwentyConfigService,
    private readonly mcpReadClientResourceService: McpReadClientResourceService,
  ) {}

  async generateApplicationAccessToken({
    workspaceId,
    applicationId,
    userWorkspaceId,
    userId,
  }: {
    workspaceId: string;
    applicationId: string;
    userWorkspaceId?: string;
    userId?: string;
  }): Promise<AuthToken> {
    await this.validateWorkspaceAndApplication(workspaceId, applicationId);
    this.assertNotReservedZoDocumentSearchApplication({
      workspaceId,
      applicationId,
    });
    const resource = this.mcpReadClientResourceService.resourceFor({
      workspaceId,
      applicationId,
    });
    await this.assertMcpReadUserBinding({
      resource,
      workspaceId,
      userId,
      userWorkspaceId,
    });

    const expiresIn = this.twentyConfigService.get(
      'APPLICATION_ACCESS_TOKEN_EXPIRES_IN',
    );

    return this.signApplicationToken({
      workspaceId,
      applicationId,
      userWorkspaceId,
      userId,
      tokenType: JwtTokenTypeEnum.APPLICATION_ACCESS,
      expiresIn,
      resource,
    });
  }

  async generateZoDocumentSearchApplicationAccessToken({
    workspaceId,
    applicationId,
    userWorkspaceId,
    userId,
  }: {
    workspaceId: string;
    applicationId: string;
    userWorkspaceId: string;
    userId: string;
  }): Promise<AuthToken> {
    await this.validateWorkspaceAndApplication(workspaceId, applicationId);

    if (
      !this.mcpReadClientResourceService.isApprovedZoReadApplication({
        workspaceId,
        applicationId,
      })
    ) {
      throw new AuthException(
        'ZO document search application is not approved',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }

    await this.assertMcpReadUserBinding({
      resource: ZO_DOCUMENT_SEARCH_TOKEN_RESOURCE,
      workspaceId,
      userId,
      userWorkspaceId,
    });

    const expiresIn = this.twentyConfigService.get(
      'APPLICATION_ACCESS_TOKEN_EXPIRES_IN',
    );

    return this.signApplicationToken({
      workspaceId,
      applicationId,
      userWorkspaceId,
      userId,
      tokenType: JwtTokenTypeEnum.APPLICATION_ACCESS,
      expiresIn,
      resource: ZO_DOCUMENT_SEARCH_TOKEN_RESOURCE,
    });
  }

  async generateApplicationTokenPair({
    workspaceId,
    applicationId,
    userWorkspaceId,
    userId,
  }: {
    workspaceId: string;
    applicationId: string;
    userWorkspaceId?: string;
    userId?: string;
  }): Promise<{
    applicationAccessToken: AuthToken;
    applicationRefreshToken: AuthToken;
  }> {
    await this.validateWorkspaceAndApplication(workspaceId, applicationId);
    this.assertNotReservedZoDocumentSearchApplication({
      workspaceId,
      applicationId,
    });
    const resource = this.mcpReadClientResourceService.resourceFor({
      workspaceId,
      applicationId,
    });
    await this.assertMcpReadUserBinding({
      resource,
      workspaceId,
      userId,
      userWorkspaceId,
    });

    return this.issueApplicationTokenPair({
      workspaceId,
      applicationId,
      userWorkspaceId,
      userId,
      resource,
    });
  }

  private async issueApplicationTokenPair({
    workspaceId,
    applicationId,
    userWorkspaceId,
    userId,
    resource,
  }: {
    workspaceId: string;
    applicationId: string;
    userWorkspaceId?: string;
    userId?: string;
    resource?: ApplicationTokenResource;
  }): Promise<{
    applicationAccessToken: AuthToken;
    applicationRefreshToken: AuthToken;
  }> {
    const accessTokenExpiresIn = this.twentyConfigService.get(
      'APPLICATION_ACCESS_TOKEN_EXPIRES_IN',
    );
    const refreshTokenExpiresIn = this.twentyConfigService.get(
      'APPLICATION_REFRESH_TOKEN_EXPIRES_IN',
    );

    const [applicationAccessToken, applicationRefreshToken] = await Promise.all(
      [
        this.signApplicationToken({
          workspaceId,
          applicationId,
          userWorkspaceId,
          userId,
          tokenType: JwtTokenTypeEnum.APPLICATION_ACCESS,
          expiresIn: accessTokenExpiresIn,
          resource,
        }),
        this.signApplicationToken({
          workspaceId,
          applicationId,
          userWorkspaceId,
          userId,
          tokenType: JwtTokenTypeEnum.APPLICATION_REFRESH,
          expiresIn: refreshTokenExpiresIn,
          resource,
        }),
      ],
    );

    return { applicationAccessToken, applicationRefreshToken };
  }

  async validateApplicationRefreshToken(
    refreshToken: string,
  ): Promise<ApplicationRefreshTokenJwtPayload> {
    try {
      await this.jwtWrapperService.verifyJwtToken(refreshToken);

      const payload =
        this.jwtWrapperService.decode<ApplicationRefreshTokenJwtPayload>(
          refreshToken,
          { json: true },
        );

      if (payload.type !== JwtTokenTypeEnum.APPLICATION_REFRESH) {
        throw new AuthException(
          'Expected an application refresh token',
          AuthExceptionCode.INVALID_JWT_TOKEN_TYPE,
        );
      }

      return payload;
    } catch (error) {
      if (
        error instanceof AuthException &&
        (error.code === AuthExceptionCode.UNAUTHENTICATED ||
          error.code === AuthExceptionCode.INVALID_JWT_TOKEN_TYPE)
      ) {
        throw new AuthException(
          APPLICATION_REFRESH_TOKEN_INVALID_OR_EXPIRED_MESSAGE,
          AuthExceptionCode.APPLICATION_REFRESH_TOKEN_INVALID_OR_EXPIRED,
        );
      }

      throw error;
    }
  }

  async validateApplicationAccessToken(
    token: string,
  ): Promise<ApplicationAccessTokenJwtPayload> {
    try {
      await this.jwtWrapperService.verifyJwtToken(token);

      const payload =
        this.jwtWrapperService.decode<ApplicationAccessTokenJwtPayload>(token, {
          json: true,
        });

      if (payload.type !== JwtTokenTypeEnum.APPLICATION_ACCESS) {
        throw new AuthException(
          'Expected an application access token',
          AuthExceptionCode.INVALID_JWT_TOKEN_TYPE,
        );
      }

      return payload;
    } catch (error) {
      if (error instanceof AuthException) {
        throw error;
      }

      throw new AuthException(
        'Invalid application access token',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }
  }

  decodeToken(token: string): (
    | ApplicationAccessTokenJwtPayload
    | ApplicationRefreshTokenJwtPayload
  ) & {
    exp?: number;
    iat?: number;
  } {
    return this.jwtWrapperService.decode(token, { json: true });
  }

  async renewApplicationTokens(payload: {
    workspaceId: string;
    applicationId: string;
    userWorkspaceId?: string;
    userId?: string;
    resource?: ApplicationTokenResource;
  }): Promise<{
    applicationAccessToken: AuthToken;
    applicationRefreshToken: AuthToken;
  }> {
    await this.validateWorkspaceAndApplication(
      payload.workspaceId,
      payload.applicationId,
    );
    this.assertNotReservedZoDocumentSearchApplication({
      workspaceId: payload.workspaceId,
      applicationId: payload.applicationId,
    });
    const currentResource = this.mcpReadClientResourceService.resourceFor({
      workspaceId: payload.workspaceId,
      applicationId: payload.applicationId,
    });

    if (currentResource !== payload.resource) {
      throw new AuthException(
        'Application token resource is no longer current',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }

    await this.assertMcpReadUserBinding({
      resource: currentResource,
      workspaceId: payload.workspaceId,
      userId: payload.userId,
      userWorkspaceId: payload.userWorkspaceId,
    });

    return this.issueApplicationTokenPair({
      workspaceId: payload.workspaceId,
      applicationId: payload.applicationId,
      userWorkspaceId: payload.userWorkspaceId,
      userId: payload.userId,
      resource: currentResource,
    });
  }

  private async validateWorkspaceAndApplication(
    workspaceId: string,
    applicationId: string,
  ): Promise<void> {
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
    });

    assertIsDefinedOrThrow(workspace, WorkspaceNotFoundDefaultError);

    const application = await this.applicationRepository.findOne({
      where: { id: applicationId, workspaceId },
    });

    assertIsDefinedOrThrow(
      application,
      new ApplicationException(
        'Application not found',
        ApplicationExceptionCode.APPLICATION_NOT_FOUND,
      ),
    );
  }

  private assertNotReservedZoDocumentSearchApplication({
    workspaceId,
    applicationId,
  }: {
    workspaceId: string;
    applicationId: string;
  }): void {
    if (
      this.mcpReadClientResourceService.isApprovedZoReadApplication({
        workspaceId,
        applicationId,
      })
    ) {
      throw new AuthException(
        'ZO document search application tokens are server-issued only',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }
  }

  private async assertMcpReadUserBinding({
    resource,
    workspaceId,
    userId,
    userWorkspaceId,
  }: {
    resource?: ApplicationTokenResource;
    workspaceId: string;
    userId?: string;
    userWorkspaceId?: string;
  }): Promise<void> {
    if (
      resource !== MCP_READ_TOKEN_RESOURCE &&
      resource !== ZO_DOCUMENT_SEARCH_TOKEN_RESOURCE
    ) {
      return;
    }

    if (!userId || !userWorkspaceId) {
      throw new AuthException(
        'MCP read application tokens require a user workspace binding',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }

    const userWorkspace = await this.userWorkspaceRepository.findOne({
      where: { id: userWorkspaceId, userId, workspaceId },
    });

    if (!userWorkspace) {
      throw new AuthException(
        'MCP read application token user workspace binding is invalid',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }
  }

  private async signApplicationToken({
    workspaceId,
    applicationId,
    userWorkspaceId,
    userId,
    tokenType,
    expiresIn,
    resource,
  }: {
    workspaceId: string;
    applicationId: string;
    userWorkspaceId?: string;
    userId?: string;
    tokenType:
      | JwtTokenTypeEnum.APPLICATION_ACCESS
      | JwtTokenTypeEnum.APPLICATION_REFRESH;
    expiresIn: string;
    resource?: ApplicationTokenResource;
  }): Promise<AuthToken> {
    const expiresAt = addMilliseconds(new Date().getTime(), ms(expiresIn));

    const jwtPayload:
      | ApplicationAccessTokenJwtPayload
      | ApplicationRefreshTokenJwtPayload = {
      sub: applicationId,
      applicationId,
      workspaceId,
      type: tokenType,
      ...(userWorkspaceId ? { userWorkspaceId } : {}),
      ...(userId ? { userId } : {}),
      ...(resource ? { resource } : {}),
    };

    return {
      token: await this.jwtWrapperService.signAsyncOrThrow(jwtPayload, {
        expiresIn,
      }),
      expiresAt,
    };
  }
}
