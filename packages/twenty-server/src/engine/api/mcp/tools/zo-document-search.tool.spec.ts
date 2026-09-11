import { createZoDocumentSearchTool } from 'src/engine/api/mcp/tools/zo-document-search.tool';

const context = {
  workspaceId: '11111111-1111-4111-8111-111111111111',
  userId: 'user-id',
  userWorkspaceId: 'user-workspace-id',
};

describe('createZoDocumentSearchTool', () => {
  const search = jest.fn();
  const tool = createZoDocumentSearchTool({ search } as never, context);

  beforeEach(() => jest.clearAllMocks());

  it('parses direct MCP tool arguments and applies the bounded defaults', async () => {
    search.mockResolvedValue({ kind: 'zo_document_search', sources: [] });

    await tool.execute({ query: '  Evidence  ' });

    expect(search).toHaveBeenCalledWith({
      ...context,
      input: {
        query: 'Evidence',
        scope: 'current',
        limit: 5,
      },
    });
  });

  it.each([
    { query: 'Evidence', limit: 11 },
    { query: 'Evidence', scope: 'workspace' },
    { query: 'Evidence', unapproved: true },
    { query: 'Evidence', modifiedFrom: '2026-09-12T00:00:00.000Z', modifiedBefore: '2026-09-11T00:00:00.000Z' },
  ])('rejects invalid direct MCP arguments %#', (input) => {
    expect(() => tool.execute(input)).toThrow();
    expect(search).not.toHaveBeenCalled();
  });
});
