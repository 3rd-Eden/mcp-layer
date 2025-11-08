import { z } from 'zod';

/**
 * Register the files tool that emits ResourceLinks referencing shared assets.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ references: Array<{ uri: string, name: string, description: string, mimeType: string }> }} context
 */
export function registerFiles(server, context) {
  const inputSchema = {
    filter: z.string().min(1).default('*'),
    limit: z.number().int().min(1).max(context.references.length).default(context.references.length)
  };

  /**
   * Emit ResourceLinks referencing manual and note resources.
   * @param {{ filter: string, limit: number }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function filesTool(args) {
    const term = args.filter === '*' ? '' : args.filter.toLowerCase();
    const matches = context.references
      .filter(function filterReferences(entry) {
        return entry.name.toLowerCase().includes(term);
      })
      .slice(0, args.limit);

    const payload = {
      count: matches.length,
      files: matches.map(function mapMatches(entry) {
        return {
          uri: entry.uri,
          name: entry.name,
          description: entry.description,
          mimeType: entry.mimeType
        };
      })
    };

    return {
      content: [
        {
          type: 'text',
          text: `Found ${payload.count} references.`
        },
        ...matches.map(function linkReferences(entry) {
          return {
            type: 'resource_link',
            uri: entry.uri,
            name: entry.name,
            description: entry.description,
            mimeType: entry.mimeType
          };
        })
      ],
      structuredContent: payload
    };
  }

  server.registerTool(
    'files',
    {
      title: 'Files',
      description: 'List ResourceLinks for manual and note resources.',
      inputSchema,
      outputSchema: {
        count: z.number().int(),
        files: z.array(
          z.object({
            uri: z.string(),
            name: z.string(),
            description: z.string(),
            mimeType: z.string()
          })
        )
      }
    },
    filesTool
  );
}
