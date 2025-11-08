import { z } from 'zod';

/**
 * Register the rebalance tool that toggles core tool registrations to exercise debounced notifications.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ echo: ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>, add: ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']> }} handles
 */
export function registerRebalance(server, handles) {
  const inputSchema = {
    cycles: z.number().int().min(1).max(5).default(2)
  };

  /**
   * Toggle core tools repeatedly to demonstrate notification debouncing.
   * @param {{ cycles: number }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function rebalanceTool(args) {
    for (let index = 0; index < args.cycles; index += 1) {
      handles.echo.disable();
      handles.add.disable();
      handles.echo.enable();
      handles.add.enable();
    }

    return {
      content: [
        {
          type: 'text',
          text: `Rebalanced core tools for ${args.cycles} cycles.`
        }
      ],
      structuredContent: { cycles: args.cycles }
    };
  }

  server.registerTool(
    'rebalance',
    {
      title: 'Rebalance',
      description: 'Batch enable/disable operations to test debounced notifications.',
      inputSchema,
      outputSchema: {
        cycles: z.number().int().min(1)
      }
    },
    rebalanceTool
  );
}
