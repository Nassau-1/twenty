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

type McpReadClientResourceConfig = {
  enrolledApplications: readonly EnrolledApplication[];
  approvedZoReadApplication: EnrolledApplication;
};

export class McpReadClientResourceConfigError extends Error {
  constructor() {
    super('MCP read client resource configuration is invalid');
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  return {
    workspaceId: value.workspaceId.toLowerCase(),
    applicationId: value.applicationId.toLowerCase(),
  };
};

const parseApprovedZoReadApplication = (
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

  return {
    workspaceId: value.workspaceId.toLowerCase(),
    applicationId: value.applicationId.toLowerCase(),
  };
};

@Injectable()
export class McpReadClientResourceService {
  constructor(private readonly twentyConfigService: TwentyConfigService) {}

  resourceFor({
    workspaceId,
    applicationId,
  }: EnrolledApplication): ApplicationTokenResource | undefined {
    return this.isEnrolledApplication({
      workspaceId: workspaceId.toLowerCase(),
      applicationId: applicationId.toLowerCase(),
    })
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
          entry.workspaceId === workspaceId.toLowerCase() &&
          entry.applicationId === applicationId.toLowerCase(),
      ) ?? false
    );
  }

  approvedZoReadApplication(
    workspaceId: string,
  ): EnrolledApplication | undefined {
    const binding = this.readConfig()?.approvedZoReadApplication;

    return binding?.workspaceId === workspaceId.toLowerCase()
      ? binding
      : undefined;
  }

  isApprovedZoReadApplication({
    workspaceId,
    applicationId,
  }: EnrolledApplication): boolean {
    const approved = this.approvedZoReadApplication(workspaceId);

    return approved?.applicationId === applicationId.toLowerCase();
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
        throw new McpReadClientResourceConfigError();
      }

      const enrolledApplications = parsed.enrolledApplications.map(
        parseEnrolledApplication,
      );
      const approvedZoReadApplication = parseApprovedZoReadApplication(
        parsed.approvedZoReadApplication,
      );

      if (
        enrolledApplications.length === 0 ||
        enrolledApplications.some((entry) => entry === undefined) ||
        !approvedZoReadApplication
      ) {
        throw new McpReadClientResourceConfigError();
      }

      const uniqueEnrollments = new Set(
        enrolledApplications.map(
          (entry) => `${entry.workspaceId}:${entry.applicationId}`,
        ),
      );

      if (uniqueEnrollments.size !== enrolledApplications.length) {
        throw new McpReadClientResourceConfigError();
      }

      if (
        enrolledApplications.some(
          (entry) =>
            entry.workspaceId === approvedZoReadApplication.workspaceId &&
            entry.applicationId === approvedZoReadApplication.applicationId,
        )
      ) {
        throw new McpReadClientResourceConfigError();
      }

      return {
        enrolledApplications: enrolledApplications as EnrolledApplication[],
        approvedZoReadApplication,
      };
    } catch (error) {
      if (error instanceof McpReadClientResourceConfigError) {
        throw error;
      }

      throw new McpReadClientResourceConfigError();
    }
  }
}
