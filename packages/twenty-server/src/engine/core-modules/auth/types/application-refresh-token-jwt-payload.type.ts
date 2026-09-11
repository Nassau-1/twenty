import { type CommonPropertiesJwtPayload } from 'src/engine/core-modules/auth/types/common-properties-jwt-payload.type';
import { JwtTokenTypeEnum } from 'src/engine/core-modules/auth/types/jwt-token-type.enum';
import { type ApplicationTokenResource } from 'src/engine/core-modules/auth/types/application-token-resource.type';

export type ApplicationRefreshTokenJwtPayload = CommonPropertiesJwtPayload & {
  type: JwtTokenTypeEnum.APPLICATION_REFRESH;
  workspaceId: string;
  applicationId: string;
  userWorkspaceId?: string;
  userId?: string;
  resource?: ApplicationTokenResource;
};
