import { z } from 'zod';

/**
 * Register a tool that accepts array/object inputs.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerBatch(server) {
  const inputSchema = {
    items: z.array(z.string()).min(1, 'Provide at least one item'),
    meta: z.object({ tag: z.string().min(1, 'Tag is required') })
  };

  /**
   * Summarize array/object inputs.
   * @param {{ items: string[], meta: { tag: string } }} args - Batch input values.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function batchTool(args) {
    return {
      content: [
        {
          type: 'text',
          text: `Batch ${args.meta.tag} contains ${args.items.length} items.`
        }
      ],
      structuredContent: {
        count: args.items.length,
        tag: args.meta.tag
      }
    };
  }

  return server.registerTool(
    'batch',
    {
      title: 'Batch',
      description: 'Accepts array and object inputs for CLI parsing tests.',
      inputSchema
    },
    batchTool
  );
}
