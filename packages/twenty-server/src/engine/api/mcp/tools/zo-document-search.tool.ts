import {
  type ZoDocumentSearchService,
  zoDocumentSearchInputSchema,
} from 'src/engine/api/mcp/services/zo-document-search.service';

export const ZO_DOCUMENT_SEARCH_TOOL_NAME = 'search_zo_documents';

export const createZoDocumentSearchTool = (
  zoDocumentSearchService: ZoDocumentSearchService,
  context: {
    workspaceId: string;
    userId: string | undefined;
    userWorkspaceId: string | undefined;
  },
) => ({
  description:
    'Search authorized ZO document excerpts. Results are limited to indexed documents you are currently allowed to read; no result does not prove absence.',
  execute: (input: unknown) =>
    zoDocumentSearchService.search({
      ...context,
      input: zoDocumentSearchInputSchema.parse(input),
    }),
});
