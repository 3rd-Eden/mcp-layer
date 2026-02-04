import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { debouncedNotifications, info, instructions } from './config.js';
import { manual } from './data/manual.js';
import { notes } from './data/notes.js';
import { references } from './data/references.js';
import { registerPrompts } from './prompts/index.js';
import { registerResources } from './resources/index.js';
import { createCapabilityChecker } from './shared/capabilities.js';
import { registerResourceSubscriptions } from './subscriptions/resources.js';
import { registerTools } from './tools/index.js';

/**
 * Build an MCP server instance pre-configured with tools, resources, and prompts.
 * @returns {McpServer}
 */
export function build() {
  const server = new McpServer(info, {
    instructions,
    debouncedNotificationMethods: debouncedNotifications,
    capabilities: {
      logging: {}
    }
  });

  const context = { manual, notes, references };
  const hasCapability = createCapabilityChecker(server);
  const subscriptions = registerResourceSubscriptions(server, {
    isSubscribable(uri) {
      return uri.startsWith('note://');
    }
  });

  registerTools(server, context, { hasCapability }, subscriptions);
  registerResources(server, context);
  registerPrompts(server);

  return server;
}

/**
 * Start the test server using stdio transport for integration scenarios.
 * @param {{ server?: McpServer, transport?: StdioServerTransport }} [opts] - Optional overrides for the server instance and transport.
 * @returns {Promise<{ server: McpServer, transport: StdioServerTransport }>}
 */
export async function start(opts = {}) {
  const server = opts.server ?? build();
  const transport = opts.transport ?? new StdioServerTransport();

  // Use stdio transport so callers can spawn this server as a subprocess during tests.
  await server.connect(transport);

  return { server, transport };
}
