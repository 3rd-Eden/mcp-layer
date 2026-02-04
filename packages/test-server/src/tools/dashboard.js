import { z } from 'zod';

const uri = 'ui://dashboard/app.html';
const csp = "default-src 'self'";
const permissions = ['clipboard-read'];

/**
 * Register a tool that declares an MCP App UI resource.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerDashboard(server) {
  const inputSchema = {
    name: z.string().min(1, 'Name is required')
  };

  /**
   * Return a simple payload while the host renders the UI resource.
   * @param {{ name: string }} args - Request input used for the response payload.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function dashboardTool(args) {
    return {
      content: [
        {
          type: 'text',
          text: `Dashboard ready for ${args.name}.`
        }
      ],
      structuredContent: {
        name: args.name,
        resourceUri: uri
      }
    };
  }

  return server.registerTool(
    'dashboard',
    {
      title: 'Dashboard',
      description: 'Return a dashboard with an MCP App UI resource.',
      inputSchema,
      _meta: {
        ui: {
          resourceUri: uri,
          csp,
          permissions
        }
      }
    },
    dashboardTool
  );
}
