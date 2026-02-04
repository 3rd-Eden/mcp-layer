import { registerWelcomePrompt } from './welcome.js';

/**
 * Register all prompts exposed by the server.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register prompts on.
 */
export function registerPrompts(server) {
  registerWelcomePrompt(server);
}
