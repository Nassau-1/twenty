import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ApplicationTokenService } from 'src/engine/core-modules/auth/token/services/application-token.service';
import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';

const ZO_DOCUMENT_SEARCH_URL =
  'http://ninpo-api:3001/api/knowledge-fabric/documents/search';
const MAX_REQUEST_BYTES = 8_192;
const MAX_RESPONSE_BYTES = 98_304;
const REQUEST_TIMEOUT_MS = 30_000;

const INFORMATION_DOMAINS = [
  'received_source',
  'team_work',
  'expert_work',
  'communication',
  'structured_financial',
  'ai_generated',
] as const;

const SOURCE_FAMILIES = [
  'onedrive_file',
  'sharepoint_file',
  'twenty_note',
  'twenty_email',
  'twenty_company',
  'twenty_opportunity',
  'email_attachment',
  'call',
  'call_transcript',
  'legal_entity_record',
  'financial_snapshot',
  'eon_artifact',
] as const;

const NATIVE_DESTINATION_KINDS = [
  'onedrive_item',
  'sharepoint_item',
  'twenty_record',
  'legal_record',
  'zo_call',
  'zo_artifact',
] as const;

const isIsoDateTime = (value: string) => Number.isFinite(Date.parse(value));

export const zoDocumentSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(2_000),
    scope: z.enum(['current', 'all']).default('current'),
    companyId: z.string().uuid().optional(),
    opportunityId: z.string().uuid().optional(),
    informationDomains: z
      .array(z.enum(INFORMATION_DOMAINS))
      .min(1)
      .max(6)
      .optional(),
    modifiedFrom: z.iso.datetime().optional(),
    modifiedBefore: z.iso.datetime().optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .strict()
  .refine(
    (value) =>
      !value.modifiedFrom ||
      !value.modifiedBefore ||
      Date.parse(value.modifiedFrom) < Date.parse(value.modifiedBefore),
    { message: 'modifiedFrom must precede modifiedBefore' },
  );

export type ZoDocumentSearchInput = z.infer<typeof zoDocumentSearchInputSchema>;

type PublicDocumentSource = {
  citationId: string;
  passageId: string;
  title: string;
  sourceObjectId: string;
  contentVersionId: string;
  sourceFamily: (typeof SOURCE_FAMILIES)[number];
  informationDomain: (typeof INFORMATION_DOMAINS)[number];
  lifecycle: 'current' | 'historical';
  sourceModifiedAt: string;
  nativeDestination: Record<string, unknown>;
  excerpt: string;
  excerptTruncated: boolean;
};

export type ZoDocumentSearchResult = {
  kind: 'zo_document_search';
  sources: PublicDocumentSource[];
  coverage: 'indexed_authorized_documents';
  searchTruncated: boolean;
};

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error();
  }

  return value as Record<string, unknown>;
};

const text = (value: unknown, max = 256): string => {
  if (typeof value !== 'string' || !value || value.length > max) {
    throw new Error();
  }

  return value;
};

const oneOf = <T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] => {
  const parsed = text(value);

  if (!allowed.includes(parsed)) {
    throw new Error();
  }

  return parsed as T[number];
};

const publicSource = (value: unknown): PublicDocumentSource => {
  const source = record(value);
  const destination = record(source.nativeDestination);
  const sourceObjectId = text(source.sourceObjectId);

  if (
    destination.sourceObjectId !== sourceObjectId ||
    typeof source.excerptTruncated !== 'boolean'
  ) {
    throw new Error();
  }

  const nativeDestination: Record<string, unknown> = {
    kind: oneOf(destination.kind, NATIVE_DESTINATION_KINDS),
    sourceObjectId,
    nativeObjectId: text(destination.nativeObjectId),
  };

  if (destination.anchor !== undefined) {
    const anchor = record(destination.anchor);
    const safeAnchor: Record<string, unknown> = {};

    for (const key of ['page', 'startMs', 'endMs']) {
      const number = anchor[key];

      if (number === undefined) {
        continue;
      }

      if (
        typeof number !== 'number' ||
        !Number.isSafeInteger(number) ||
        number < (key === 'startMs' ? 0 : 1)
      ) {
        throw new Error();
      }

      safeAnchor[key] = number;
    }

    if (anchor.section !== undefined) {
      safeAnchor.section = text(anchor.section, 512);
    }

    nativeDestination.anchor = safeAnchor;
  }

  const sourceModifiedAt = text(source.sourceModifiedAt, 64);

  if (!isIsoDateTime(sourceModifiedAt)) {
    throw new Error();
  }

  return {
    citationId: text(source.citationId),
    passageId: text(source.passageId),
    title: text(source.title, 512),
    sourceObjectId,
    contentVersionId: text(source.contentVersionId),
    sourceFamily: oneOf(source.sourceFamily, SOURCE_FAMILIES),
    informationDomain: oneOf(source.informationDomain, INFORMATION_DOMAINS),
    lifecycle: oneOf(source.lifecycle, ['current', 'historical']),
    sourceModifiedAt,
    nativeDestination,
    excerpt: text(source.excerpt, 6_000),
    excerptTruncated: source.excerptTruncated,
  };
};

const readBoundedJson = async (response: Response): Promise<unknown> => {
  const contentLength = response.headers.get('content-length');

  if (
    !response.ok ||
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .includes('application/json') ||
    !response.body ||
    (contentLength !== null &&
      (!/^\d+$/.test(contentLength) ||
        Number(contentLength) > MAX_RESPONSE_BYTES))
  ) {
    await response.body?.cancel();
    throw new Error();
  }

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let length = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        throw new Error();
      }

      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    body.set(part, offset);
    offset += part.byteLength;
  }

  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
};

@Injectable()
export class ZoDocumentSearchService {
  constructor(
    private readonly applicationTokenService: ApplicationTokenService,
    private readonly mcpReadClientResourceService: McpReadClientResourceService,
  ) {}

  async search({
    workspaceId,
    userId,
    userWorkspaceId,
    input,
  }: {
    workspaceId: string;
    userId: string | undefined;
    userWorkspaceId: string | undefined;
    input: ZoDocumentSearchInput;
  }): Promise<ZoDocumentSearchResult> {
    if (!userId || !userWorkspaceId) {
      throw new Error('DOCUMENT_SEARCH_UNAVAILABLE');
    }

    const approved =
      this.mcpReadClientResourceService.approvedZoReadApplication(workspaceId);
    if (!approved) {
      throw new Error('DOCUMENT_SEARCH_UNAVAILABLE');
    }

    const body = JSON.stringify(input);
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
      throw new Error('DOCUMENT_SEARCH_UNAVAILABLE');
    }

    try {
      const { token } =
        await this.applicationTokenService.generateApplicationAccessToken({
          workspaceId,
          applicationId: approved.applicationId,
          userId,
          userWorkspaceId,
        });
      const response = await fetch(ZO_DOCUMENT_SEARCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const result = await readBoundedJson(response);

      if (!isRecordDocumentSearchResult(result) || result.sources.length > 10) {
        throw new Error();
      }

      return {
        kind: 'zo_document_search',
        sources: result.sources.map(publicSource),
        coverage: 'indexed_authorized_documents',
        searchTruncated: result.searchTruncated,
      };
    } catch {
      throw new Error('DOCUMENT_SEARCH_UNAVAILABLE');
    }
  }
}

const isRecordDocumentSearchResult = (
  value: unknown,
): value is {
  kind: 'zo_document_search';
  sources: unknown[];
  coverage: 'indexed_authorized_documents';
  searchTruncated: boolean;
} => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const result = value as Record<string, unknown>;

  return (
    result.kind === 'zo_document_search' &&
    Array.isArray(result.sources) &&
    result.coverage === 'indexed_authorized_documents' &&
    typeof result.searchTruncated === 'boolean'
  );
};
