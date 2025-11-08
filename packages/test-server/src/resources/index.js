import { registerManualResource } from './manual.js';
import { registerNotesResource } from './notes.js';

/**
 * Register all resources exposed by the server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ manual: string, notes: Map<string, Record<string, string>> }} context
 */
export function registerResources(server, context) {
  registerManualResource(server, context);
  registerNotesResource(server, context);
}
