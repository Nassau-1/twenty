import { ApplicationTokenService } from 'src/engine/core-modules/auth/token/services/application-token.service';
import { McpReadClientResourceService } from 'src/engine/core-modules/auth/token/services/mcp-read-client-resource.service';
import {
  ZoDocumentSearchService,
  zoDocumentSearchInputSchema,
} from 'src/engine/api/mcp/services/zo-document-search.service';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const zoApplicationId = '44444444-4444-4444-8444-444444444444';
const userId = 'user-id';
const userWorkspaceId = 'user-workspace-id';

describe('ZoDocumentSearchService', () => {
  const applicationTokenService = {
    generateApplicationAccessToken: jest.fn(),
  } as unknown as jest.Mocked<ApplicationTokenService>;
  const resourceService = {
    approvedZoReadApplication: jest.fn(),
  } as unknown as jest.Mocked<McpReadClientResourceService>;
  const service = new ZoDocumentSearchService(
    applicationTokenService,
    resourceService,
  );
  const input = zoDocumentSearchInputSchema.parse({ query: 'Read evidence' });

  beforeEach(() => {
    jest.clearAllMocks();
    resourceService.approvedZoReadApplication.mockReturnValue({
      workspaceId,
      applicationId: zoApplicationId,
    });
    applicationTokenService.generateApplicationAccessToken.mockResolvedValue({
      token: 'server-only-execution-token',
      expiresAt: new Date(),
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('mints an exact user-bound execution token and calls only the literal document endpoint', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        kind: 'zo_document_search',
        sources: [],
        coverage: 'indexed_authorized_documents',
        searchTruncated: false,
      }),
    );

    await expect(
      service.search({ workspaceId, userId, userWorkspaceId, input }),
    ).resolves.toEqual({
      kind: 'zo_document_search',
      sources: [],
      coverage: 'indexed_authorized_documents',
      searchTruncated: false,
    });

    expect(
      applicationTokenService.generateApplicationAccessToken,
    ).toHaveBeenCalledWith({
      workspaceId,
      applicationId: zoApplicationId,
      userId,
      userWorkspaceId,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://ninpo-api:3001/api/knowledge-fabric/documents/search',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        headers: expect.objectContaining({
          Authorization: 'Bearer server-only-execution-token',
        }),
      }),
    );
  });

  it('does not mint a token or make a request without a full authenticated user context', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');

    await expect(
      service.search({
        workspaceId,
        userId: undefined,
        userWorkspaceId,
        input,
      }),
    ).rejects.toThrow('DOCUMENT_SEARCH_UNAVAILABLE');

    expect(
      applicationTokenService.generateApplicationAccessToken,
    ).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not mint a token when the server configuration lacks the exact execution app', async () => {
    const fetchMock = jest.spyOn(global, 'fetch');
    resourceService.approvedZoReadApplication.mockReturnValue(undefined);

    await expect(
      service.search({ workspaceId, userId, userWorkspaceId, input }),
    ).rejects.toThrow('DOCUMENT_SEARCH_UNAVAILABLE');

    expect(
      applicationTokenService.generateApplicationAccessToken,
    ).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['userId', 'workspaceId', 'authorization', 'url', 'method'])(
    'rejects caller-controlled execution fields: %s',
    (field) => {
      expect(
        zoDocumentSearchInputSchema.safeParse({
          query: 'Read evidence',
          [field]: 'spoofed',
        }).success,
      ).toBe(false);
    },
  );

  it('discards an oversized or malformed upstream result behind a fixed error', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('x'.repeat(98_305), {
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(
      service.search({ workspaceId, userId, userWorkspaceId, input }),
    ).rejects.toThrow('DOCUMENT_SEARCH_UNAVAILABLE');
  });

  it('rebuilds a bounded public result without retaining upstream-only fields', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(
      Response.json({
        kind: 'zo_document_search',
        coverage: 'indexed_authorized_documents',
        searchTruncated: false,
        upstreamOnly: 'discarded',
        sources: [
          {
            citationId: 'binding-a',
            passageId: 'passage-a',
            title: 'Authorized document',
            sourceObjectId: 'source-a',
            contentVersionId: 'version-a',
            sourceFamily: 'onedrive_file',
            informationDomain: 'team_work',
            lifecycle: 'current',
            sourceModifiedAt: '2026-09-11T00:00:00.000Z',
            nativeDestination: {
              kind: 'onedrive_item',
              sourceObjectId: 'source-a',
              nativeObjectId: 'native-a',
              upstreamOnly: 'discarded',
            },
            excerpt: 'Authorized excerpt',
            excerptTruncated: false,
            privateBinding: 'discarded',
          },
        ],
      }),
    );

    await expect(
      service.search({ workspaceId, userId, userWorkspaceId, input }),
    ).resolves.toEqual({
      kind: 'zo_document_search',
      coverage: 'indexed_authorized_documents',
      searchTruncated: false,
      sources: [
        {
          citationId: 'binding-a',
          passageId: 'passage-a',
          title: 'Authorized document',
          sourceObjectId: 'source-a',
          contentVersionId: 'version-a',
          sourceFamily: 'onedrive_file',
          informationDomain: 'team_work',
          lifecycle: 'current',
          sourceModifiedAt: '2026-09-11T00:00:00.000Z',
          nativeDestination: {
            kind: 'onedrive_item',
            sourceObjectId: 'source-a',
            nativeObjectId: 'native-a',
          },
          excerpt: 'Authorized excerpt',
          excerptTruncated: false,
        },
      ],
    });
  });
});
