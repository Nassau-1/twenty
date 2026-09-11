import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { msg } from '@lingui/core/macro';
import { addMilliseconds } from 'date-fns';
import { type Request } from 'express';
import {
  Kind,
  parse,
  type FieldNode,
  type SelectionSetNode,
} from 'graphql';
import ms from 'ms';
import { assertIsDefinedOrThrow } from 'twenty-shared/utils';
import { isWorkspaceProvisioned } from 'twenty-shared/workspace';
import { Repository } from 'typeorm';

import {
  AuthException,
  AuthExceptionCode,
} from 'src/engine/core-modules/auth/auth.exception';
import { type AuthToken } from 'src/engine/core-modules/auth/dto/auth-token.dto';
import { JwtAuthStrategy } from 'src/engine/core-modules/auth/strategies/jwt.auth.strategy';
import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';
import { type AuthContext } from 'src/engine/core-modules/auth/types/auth-context.type';
import { type AccessTokenJwtPayload } from 'src/engine/core-modules/auth/types/access-token-jwt-payload.type';
import {
  MCP_READ_TOKEN_RESOURCE,
  ZO_DOCUMENT_SEARCH_TOKEN_RESOURCE,
} from 'src/engine/core-modules/auth/types/application-token-resource.type';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { type PlaygroundTokenJwtPayload } from 'src/engine/core-modules/auth/types/playground-token-jwt-payload.type';
import { JwtWrapperService } from 'src/engine/core-modules/jwt/services/jwt-wrapper.service';
import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { UserWorkspaceEntity } from 'src/engine/core-modules/user-workspace/user-workspace.entity';
import { UserWorkspaceNotFoundDefaultError } from 'src/engine/core-modules/user-workspace/user-workspace.exception';
import { UserEntity } from 'src/engine/core-modules/user/user.entity';
import { userValidator } from 'src/engine/core-modules/user/user.validate';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { WorkspaceNotFoundDefaultError } from 'src/engine/core-modules/workspace/workspace.exception';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { WorkspaceMemberWorkspaceEntity } from 'src/modules/workspace-member/standard-objects/workspace-member.workspace-entity';

type ExpectedSelection = {
  name: string;
  selection?: readonly ExpectedSelection[];
};

const ASK_ZO_CURRENT_PRINCIPAL_SELECTION: readonly ExpectedSelection[] = [
  {
    name: 'currentUser',
    selection: [
      { name: 'id' },
      {
        name: 'currentWorkspace',
        selection: [
          { name: 'id' },
          {
            name: 'defaultRole',
            selection: [{ name: 'id' }, { name: 'universalIdentifier' }],
          },
        ],
      },
      {
        name: 'currentUserWorkspace',
        selection: [
          { name: 'id' },
          {
            name: 'objectsPermissions',
            selection: [
              { name: 'objectMetadataId' },
              { name: 'canReadObjectRecords' },
              { name: 'canUpdateObjectRecords' },
              { name: 'restrictedFields' },
              {
                name: 'rowLevelPermissionPredicates',
                selection: [{ name: 'id' }],
              },
              {
                name: 'rowLevelPermissionPredicateGroups',
                selection: [{ name: 'id' }],
              },
            ],
          },
        ],
      },
      {
        name: 'workspaceMember',
        selection: [
          { name: 'id' },
          { name: 'userWorkspaceId' },
          {
            name: 'roles',
            selection: [
              { name: 'id' },
              { name: 'universalIdentifier' },
              { name: 'label' },
              { name: 'canUpdateAllSettings' },
              { name: 'canAccessAllTools' },
              { name: 'canReadAllObjectRecords' },
            ],
          },
        ],
      },
    ],
  },
  {
    name: 'minimalMetadata',
    selection: [
      {
        name: 'objectMetadataItems',
        selection: [
          { name: 'id' },
          { name: 'nameSingular' },
          { name: 'namePlural' },
          { name: 'isActive' },
          { name: 'isSystem' },
        ],
      },
    ],
  },
];

const isExactObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype ||
    Object.getPrototypeOf(value) === null);

const hasExactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean =>
  Object.keys(value).length === expected.length &&
  expected.every((key) => Object.hasOwn(value, key));

const matchesSelection = (
  selectionSet: SelectionSetNode,
  expected: readonly ExpectedSelection[],
): boolean =>
  selectionSet.selections.length === expected.length &&
  selectionSet.selections.every((selection, index) => {
    if (selection.kind !== Kind.FIELD) {
      return false;
    }

    const field = selection as FieldNode;
    const expectedField = expected[index];
    if (
      field.name.value !== expectedField.name ||
      field.alias ||
      field.arguments.length !== 0 ||
      field.directives.length !== 0
    ) {
      return false;
    }

    return expectedField.selection
      ? field.selectionSet !== undefined &&
          matchesSelection(field.selectionSet, expectedField.selection)
      : field.selectionSet === undefined;
  });

const isAskZoCurrentPrincipalRequest = (request: Request): boolean => {
  if (request.method !== 'POST' || request.path !== '/metadata') {
    return false;
  }

  const body: unknown = request.body;
  if (
    !isExactObject(body) ||
    !hasExactKeys(body, ['operationName', 'query', 'variables']) ||
    body.operationName !== 'AskZoCurrentPrincipal' ||
    typeof body.query !== 'string' ||
    body.query.length > 16_384 ||
    !isExactObject(body.variables) ||
    Object.keys(body.variables).length !== 0
  ) {
    return false;
  }

  try {
    const document = parse(body.query, { noLocation: true });
    if (document.definitions.length !== 1) {
      return false;
    }
    const [operation] = document.definitions;

    return (
      operation.kind === Kind.OPERATION_DEFINITION &&
      operation.operation === 'query' &&
      operation.name?.value === 'AskZoCurrentPrincipal' &&
      operation.variableDefinitions.length === 0 &&
      operation.directives.length === 0 &&
      matchesSelection(operation.selectionSet, ASK_ZO_CURRENT_PRINCIPAL_SELECTION)
    );
  } catch {
    return false;
  }
};

@Injectable()
export class AccessTokenService {
  constructor(
    private readonly jwtWrapperService: JwtWrapperService,
    private readonly jwtStrategy: JwtAuthStrategy,
    private readonly twentyConfigService: TwentyConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
    @InjectRepository(UserWorkspaceEntity)
    private readonly userWorkspaceRepository: Repository<UserWorkspaceEntity>,
    private readonly mcpReadClientResourceService: McpReadClientResourceService,
  ) {}

  private async resolveTokenSubject(
    userId: string,
    workspaceId: string,
  ): Promise<{
    user: UserEntity;
    workspace: WorkspaceEntity;
    userWorkspace: UserWorkspaceEntity;
    workspaceMemberId: string | undefined;
  }> {
    const [user, workspace, userWorkspace] = await Promise.all([
      this.userRepository.findOne({ where: { id: userId } }),
      this.workspaceRepository.findOne({ where: { id: workspaceId } }),
      this.userWorkspaceRepository.findOne({
        where: { userId, workspaceId },
      }),
    ]);

    userValidator.assertIsDefinedOrThrow(
      user,
      new AuthException('User is not found', AuthExceptionCode.INVALID_INPUT),
    );
    assertIsDefinedOrThrow(workspace, WorkspaceNotFoundDefaultError);
    assertIsDefinedOrThrow(userWorkspace, UserWorkspaceNotFoundDefaultError);

    let workspaceMemberId: string | undefined;

    if (isWorkspaceProvisioned(workspace)) {
      const authContext = buildSystemAuthContext(workspaceId);

      workspaceMemberId =
        await this.globalWorkspaceOrmManager.executeInWorkspaceContext(
          async () => {
            const workspaceMemberRepository =
              await this.globalWorkspaceOrmManager.getRepository<WorkspaceMemberWorkspaceEntity>(
                workspaceId,
                'workspaceMember',
                { shouldBypassPermissionChecks: true },
              );

            const workspaceMember = await workspaceMemberRepository.findOne({
              where: { userId: user.id },
            });

            assertIsDefinedOrThrow(
              workspaceMember,
              new AuthException(
                'User is not a member of the workspace',
                AuthExceptionCode.FORBIDDEN_EXCEPTION,
                {
                  userFriendlyMessage: msg`User is not a member of the workspace.`,
                },
              ),
            );

            return workspaceMember.id;
          },
          authContext,
        );
    }

    return { user, workspace, userWorkspace, workspaceMemberId };
  }

  async generateAccessToken({
    userId,
    workspaceId,
    authProvider,
    isImpersonating,
    impersonatorUserWorkspaceId,
    impersonatedUserWorkspaceId,
  }: Omit<
    AccessTokenJwtPayload,
    'type' | 'workspaceMemberId' | 'userWorkspaceId' | 'sub'
  >): Promise<AuthToken> {
    const expiresIn = this.twentyConfigService.get('ACCESS_TOKEN_EXPIRES_IN');
    const expiresAt = addMilliseconds(new Date().getTime(), ms(expiresIn));

    const { user, userWorkspace, workspaceMemberId } =
      await this.resolveTokenSubject(userId, workspaceId);

    const jwtPayload: AccessTokenJwtPayload = {
      sub: user.id,
      userId: user.id,
      workspaceId,
      workspaceMemberId,
      userWorkspaceId: userWorkspace.id,
      type: JwtTokenTypeEnum.ACCESS,
      authProvider,
      isImpersonating: isImpersonating === true,
      impersonatorUserWorkspaceId:
        isImpersonating === true ? impersonatorUserWorkspaceId : undefined,
      impersonatedUserWorkspaceId:
        isImpersonating === true ? impersonatedUserWorkspaceId : undefined,
    };

    const token = await this.jwtWrapperService.signAsyncOrThrow(jwtPayload, {
      expiresIn,
    });

    return { token, expiresAt };
  }

  async generatePlaygroundToken({
    userId,
    workspaceId,
    authProvider,
  }: Pick<
    PlaygroundTokenJwtPayload,
    'userId' | 'workspaceId' | 'authProvider'
  >): Promise<AuthToken> {
    const expiresIn = this.twentyConfigService.get(
      'PLAYGROUND_TOKEN_EXPIRES_IN',
    );
    const expiresAt = addMilliseconds(new Date().getTime(), ms(expiresIn));

    const { user, userWorkspace, workspaceMemberId } =
      await this.resolveTokenSubject(userId, workspaceId);

    const jwtPayload: PlaygroundTokenJwtPayload = {
      sub: user.id,
      userId: user.id,
      workspaceId,
      workspaceMemberId,
      userWorkspaceId: userWorkspace.id,
      type: JwtTokenTypeEnum.PLAYGROUND,
      authProvider,
    };

    const token = await this.jwtWrapperService.signAsyncOrThrow(jwtPayload, {
      expiresIn,
    });

    return { token, expiresAt };
  }

  async validateToken(token: string): Promise<AuthContext> {
    await this.jwtWrapperService.verifyJwtToken(token);

    const decoded = this.jwtWrapperService.decode<AccessTokenJwtPayload>(token);

    const context = await this.jwtStrategy.validate(decoded);

    return context;
  }

  async validateTokenByRequest(request: Request): Promise<AuthContext> {
    const token = this.jwtWrapperService.extractJwtFromRequest()(request);

    if (!token) {
      throw new AuthException(
        'Missing authentication token',
        AuthExceptionCode.FORBIDDEN_EXCEPTION,
      );
    }

    const authContext = await this.validateToken(token);

    this.assertApplicationResourceRequest(authContext, request);

    return authContext;
  }

  private assertApplicationResourceRequest(
    authContext: AuthContext,
    request: Request,
  ): void {
    if (!authContext.application || !authContext.workspace) {
      return;
    }

    const isEnrolled = this.mcpReadClientResourceService.isEnrolledApplication({
      workspaceId: authContext.workspace.id,
      applicationId: authContext.application.id,
    });
    const isMarked =
      authContext.applicationTokenResource === MCP_READ_TOKEN_RESOURCE;
    const isZoDocumentSearch =
      authContext.applicationTokenResource ===
      ZO_DOCUMENT_SEARCH_TOKEN_RESOURCE;
    const isMcpReadRequest =
      request.method === 'POST' && /^\/mcp\/?$/i.test(request.path);
    const isApprovedZoReadApplication =
      isZoDocumentSearch &&
      this.mcpReadClientResourceService.isApprovedZoReadApplication({
        workspaceId: authContext.workspace.id,
        applicationId: authContext.application.id,
      });

    if (
      (isEnrolled && !isMarked) ||
      (isMarked && !isEnrolled) ||
      (isMarked && !isMcpReadRequest) ||
      (isZoDocumentSearch && !isApprovedZoReadApplication) ||
      (isZoDocumentSearch && !isAskZoCurrentPrincipalRequest(request))
    ) {
      throw new AuthException(
        'Application token resource is not valid for this request',
        AuthExceptionCode.UNAUTHENTICATED,
      );
    }
  }
}
