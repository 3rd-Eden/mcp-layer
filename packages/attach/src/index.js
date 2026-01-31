import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRequire } from 'node:module';
import { Session } from '@mcp-layer/session';

const read = createRequire(import.meta.url);
const pkg = read('../package.json');
const base = {
  name: 'mcp-layer',
  version: typeof pkg.version === 'string' ? pkg.version : '0.0.0'
};

/**
 * Resolve the underlying SDK server instance from a wrapper.
 * @param {unknown} instance
 * @returns {import('@modelcontextprotocol/sdk/server/index.js').Server}
 */
function resolveServer(instance) {
  if (instance && typeof instance === 'object') {
    if (instance.server && typeof instance.server === 'object') {
      return instance.server;
    }
    return instance;
  }
  throw new TypeError('Expected an MCP server instance.');
}

/**
 * Determine whether a server is already connected to a transport.
 * @param {import('@modelcontextprotocol/sdk/server/index.js').Server} server
 * @returns {boolean}
 */
function isConnected(server) {
  return Boolean(server && server.transport);
}

/**
 * Attach to an in-process MCP server instance and return a Session.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer | import('@modelcontextprotocol/sdk/server/index.js').Server} instance
 * @param {string} name
 * @param {{ info?: { name: string, version: string }, source?: string }} [opts]
 * @returns {Promise<Session>}
 */
export async function attach(instance, name, opts = {}) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('Expected server name to be a non-empty string.');
  }

  const server = resolveServer(instance);
  if (isConnected(server)) {
    throw new Error('Server is already connected to a transport; attach requires an unconnected server.');
  }

  const info = { ...base, ...(opts.info ?? {}) };
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client(info);
  await client.connect(clientTransport);

  return new Session({
    name,
    source: opts.source ?? 'in-memory',
    entry: null,
    client,
    transport: clientTransport,
    info
  });
}

export { Session };
