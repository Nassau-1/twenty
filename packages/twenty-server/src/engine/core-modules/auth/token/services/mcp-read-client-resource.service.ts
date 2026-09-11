import { Injectable } from '@nestjs/common';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import {
  MCP_READ_TOKEN_RESOURCE,
  type ApplicationTokenResource,
} from 'src/engine/core-modules/auth/types/application-token-resource.type';

type EnrolledApplication = {
  workspaceId: string;
  applicationId: string;
};

type ApprovedZoReadFunction = EnrolledApplication & {
  logicFunctionId: string;
  checksum: string;
};

type McpReadClientResourceConfig = {
  enrolledApplications: readonly EnrolledApplication[];
  approvedZoReadFunction: ApprovedZoReadFunction;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKSUM_PATTERN = /^[0-9a-f]{32}$/i;

const isExactObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value);

const parseEnrolledApplication = (
  value: unknown,
): EnrolledApplication | undefined => {
  if (
    !isExactObject(value) ||
    Object.keys(value).length !== 2 ||
    !isUuid(value.workspaceId) ||
    !isUuid(value.applicationId)
  ) {
    return undefined;
  }

  return { workspaceId: value.workspaceId, applicationId: value.applicationId };
};

const parseApprovedZoReadFunction = (
  value: unknown,
): ApprovedZoReadFunction | undefined => {
  if (
    !isExactObject(value) ||
    Object.keys(value).length !== 4 ||
    !isUuid(value.workspaceId) ||
    !isUuid(value.applicationId) ||
    !isUuid(value.logicFunctionId) ||
    typeof value.checksum !== 'string' ||
    !CHECKSUM_PATTERN.test(value.checksum)
  ) {
    return undefined;
  }

  return {
    workspaceId: value.workspaceId,
    applicationId: value.applicationId,
    logicFunctionId: value.logicFunctionId,
    checksum: value.checksum.toLowerCase(),
  };
};

@Injectable()
export class McpReadClientResourceService {
  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  resourceFor({
    workspaceId,
    applicationId,
  }: EnrolledApplication): ApplicationTokenResource | undefined {
    return this.isEnrolledApplication({ workspaceId, applicationId })
      ? MCP_READ_TOKEN_RESOURCE
      : undefined;
  }

  isEnrolledApplication({
    workspaceId,
    applicationId,
  }: EnrolledApplication): boolean {
    const config = this.readConfig();

    return (
      config?.enrolledApplications.some(
        (entry) =>
          entry.workspaceId === workspaceId &&
          entry.applicationId === applicationId,
      ) ?? false
    );
  }

  approvedZoReadFunction(
    workspaceId: string,
  ): ApprovedZoReadFunction | undefined {
    const binding = this.readConfig()?.approvedZoReadFunction;

    return binding?.workspaceId === workspaceId ? binding : undefined;
  }

  private readConfig(): McpReadClientResourceConfig | undefined {
    const raw = this.twentyConfigService.get('MCP_READ_CLIENT_RESOURCE_CONFIG');

    if (typeof raw !== 'string' || raw.length === 0) {
      return undefined;
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (
        !isExactObject(parsed) ||
        Object.keys(parsed).length !== 2 ||
        !Array.isArray(parsed.enrolledApplications)
      ) {
        return undefined;
      }

      const enrolledApplications = parsed.enrolledApplications.map(
        parseEnrolledApplication,
      );
      const approvedZoReadFunction = parseApprovedZoReadFunction(
        parsed.approvedZoReadFunction,
      );

      if (
        enrolledApplications.length === 0 ||
        enrolledApplications.some((entry) => entry === undefined) ||
        !approvedZoReadFunction
      ) {
        return undefined;
      }

      const uniqueEnrollments = new Set(
        enrolledApplications.map(
          (entry) => `${entry.workspaceId}:${entry.applicationId}`,
        ),
      );

      if (uniqueEnrollments.size !== enrolledApplications.length) {
        return undefined;
      }

      return {
        enrolledApplications: enrolledApplications as EnrolledApplication[],
        approvedZoReadFunction,
      };
    } catch {
      return undefined;
    }
  }
}
