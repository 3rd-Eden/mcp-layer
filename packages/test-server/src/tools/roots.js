import { z } from 'zod';

/**
 * Register the roots tool that calls roots/list on capable clients.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ hasCapability: (capability: 'roots') => boolean }} capabilities
 */
export function registerRoots(server, capabilities) {
  const inputSchema = {
    includeMeta: z.boolean().default(false)
  };

  /**
   * Request roots/list from the client to expose workspace locations.
   * @param {{ includeMeta: boolean }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function rootsTool(args) {
    if (!capabilities.hasCapability('roots')) {
      const notice = 'Connected client did not declare roots capability.';
      return {
        content: [
          {
            type: 'text',
            text: notice
          }
        ],
        structuredContent: {
          count: 0,
          roots: [],
          usedCapability: false
        }
      };
    }

    try {
      const result = await server.server.listRoots({});
      const roots = result.roots.map(function mapRoots(entry) {
        return {
          uri: entry.uri,
          name: entry.name ?? null,
          meta: args.includeMeta ? entry._meta ?? null : null
        };
      });
      return {
        content: [
          {
            type: 'text',
            text: `Received ${roots.length} roots from client.`
          }
        ],
        structuredContent: {
          count: roots.length,
          roots,
          usedCapability: true
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: message
          }
        ],
        structuredContent: {
          count: 0,
          roots: [],
          usedCapability: true,
          error: message
        }
      };
    }
  }

  server.registerTool(
    'roots',
    {
      title: 'Roots',
      description: 'Call roots/list on capable clients.',
      inputSchema,
      outputSchema: {
        count: z.number().int(),
        roots: z.array(
          z.object({
            uri: z.string(),
            name: z.string().nullable(),
            meta: z.record(z.unknown()).nullable().optional()
          })
        ),
        usedCapability: z.boolean(),
        error: z.string().optional()
      }
    },
    rootsTool
  );
}
