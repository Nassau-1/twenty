export const MCP_READ_TOKEN_RESOURCE = 'mcp_read' as const;
export const ZO_DOCUMENT_SEARCH_TOKEN_RESOURCE = 'zo_document_search' as const;

export type ApplicationTokenResource =
  | typeof MCP_READ_TOKEN_RESOURCE
  | typeof ZO_DOCUMENT_SEARCH_TOKEN_RESOURCE;
