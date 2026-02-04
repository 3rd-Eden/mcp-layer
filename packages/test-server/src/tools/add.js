import { z } from 'zod';

/**
 * Register the add tool returning structured totals.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerAdd(server) {
  const inputSchema = {
    first: z.number(),
    second: z.number()
  };

  /**
   * Sum two numbers to demonstrate structured responses.
   * @param {{ first: number, second: number }} args - Numeric operands provided by the caller.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function addTool(args) {
    const total = args.first + args.second;
    return {
      content: [
        {
          type: 'text',
          text: `Total: ${total}`
        }
      ],
      structuredContent: { total }
    };
  }

  return server.registerTool(
    'add',
    {
      title: 'Add',
      description: 'Combine two numbers and return the sum.',
      inputSchema,
      outputSchema: {
        total: z.number()
      }
    },
    addTool
  );
}
