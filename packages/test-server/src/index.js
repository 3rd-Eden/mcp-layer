import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { debouncedNotifications, info as defaultInfo, instructions } from './config.js';
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
 *
 * targeted metadata overrides (name/version) without custom servers.
 *
 * @param {{ info?: { name?: string, version?: string } }} [opts] - Optional metadata overrides.
 * @returns {McpServer}
 */
export function build(opts = {}) {
  const info = opts.info ? { ...defaultInfo, ...opts.info } : defaultInfo;
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
 *
 * exercising the standard test-server surface.
 *
 * @param {{ server?: McpServer, transport?: StdioServerTransport, info?: { name?: string, version?: string } }} [opts] - Optional overrides for the server instance, transport, or metadata.
 * @returns {Promise<{ server: McpServer, transport: StdioServerTransport }>}
 */
export async function start(opts = {}) {
  const server = opts.server ?? build(opts);
  const transport = opts.transport ?? new StdioServerTransport();

  // Use stdio transport so callers can spawn this server as a subprocess during tests.
  await server.connect(transport);

  return { server, transport };
}
