import { registerManualResource } from './manual.js';
import { registerNotesResource } from './notes.js';
import { registerUi } from './ui.js';

/**
 * Register all resources exposed by the server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register resources on.
 * @param {{ manual: string, notes: Map<string, Record<string, string>> }} context - Shared data backing the resources.
 */
export function registerResources(server, context) {
  registerManualResource(server, context);
  registerNotesResource(server, context);
  registerUi(server);
}
