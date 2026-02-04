import { z } from 'zod';

/**
 * Register a tool that exercises annotations and _meta without output schema.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerAnnotated(server) {
  const inputSchema = {
    label: z.string().min(1, 'Label is required')
  };

  /**
   * Return a plain text response for annotation coverage.
   * @param {{ label: string }} args - Label input used in the response text.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function annotatedTool(args) {
    return {
      content: [
        {
          type: 'text',
          text: `Annotated tool saw ${args.label}.`
        }
      ]
    };
  }

  return server.registerTool(
    'annotated',
    {
      description: 'Tool used to exercise annotation/title fallback and _meta extraction.',
      inputSchema,
      annotations: {
        title: 'Annotated Tool',
        readOnlyHint: true
      },
      _meta: {
        owner: 'mcp-layer-schema'
      }
    },
    annotatedTool
  );
}
