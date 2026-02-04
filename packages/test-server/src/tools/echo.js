import { z } from 'zod';

/**
 * Register the echo tool that optionally uppercases responses.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerEcho(server) {
  const inputSchema = {
    text: z.string().min(1, 'Text must be provided'),
    loud: z.boolean().default(false)
  };

  /**
   * Repeat supplied text and optionally uppercase the response.
   * @param {{ text: string, loud: boolean }} args - Request input used to build the response.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function echoTool(args) {
    const text = args.loud ? args.text.toUpperCase() : args.text;
    return {
      content: [
        {
          type: 'text',
          text
        }
      ],
      structuredContent: { text, loud: args.loud }
    };
  }

  return server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Repeat supplied text; uppercase when loud is true.',
      inputSchema,
      outputSchema: {
        text: z.string(),
        loud: z.boolean()
      }
    },
    echoTool
  );
}
