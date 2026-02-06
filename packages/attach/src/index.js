import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createRequire } from 'node:module';
import { LayerError } from '@mcp-layer/error';
import { Session } from '@mcp-layer/session';
import { attachWithProvider, matchProvider } from './providers/index.js';

const read = createRequire(import.meta.url);
const pkg = read('../package.json');
const base = {
  name: 'mcp-layer',
  version: typeof pkg.version === 'string' ? pkg.version : '0.0.0'
};

/**
 * Resolve the underlying SDK server instance from a wrapper.
 * @param {unknown} instance - Server instance or wrapper object that exposes a `server` field.
 * @returns {import('@modelcontextprotocol/sdk/server/index.js').Server}
 */
function resolveServer(instance) {
  if (instance && typeof instance === 'object') {
    if (instance.server && typeof instance.server === 'object') return instance.server;
    return instance;
  }
  throw new LayerError({
    name: 'attach',
    method: 'resolveServer',
    message: 'Expected an MCP server instance.',
  });
}

/**
 * Determine whether a server is already connected to a transport.
 * @param {import('@modelcontextprotocol/sdk/server/index.js').Server} server - SDK server to inspect for an attached transport.
 * @returns {boolean}
 */
function isConnected(server) {
  return Boolean(server && server.transport);
}

/**
 * Attach to an in-process MCP server instance and return a Session.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer | import('@modelcontextprotocol/sdk/server/index.js').Server | import('fastify').FastifyInstance} instance - MCP server instance, wrapper, or Platformatic Fastify MCP instance.
 * @param {string} name - Human-readable session name used in the Session metadata.
 * @param {{ info?: { name: string, version: string }, source?: string, path?: string }} [opts] - Optional client metadata, source label, and Fastify endpoint override.
 * @returns {Promise<Session>}
 */
export async function attach(instance, name, opts = {}) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new LayerError({
      name: 'attach',
      method: 'attach',
      message: 'Expected server name to be a non-empty string.',
    });
  }

  const provider = matchProvider(instance);
  if (provider) return attachWithProvider(provider, instance, name, opts);

  const server = resolveServer(instance);
  if (isConnected(server)) {
    throw new LayerError({
      name: 'attach',
      method: 'attach',
      message: 'Server is already connected to a transport; attach requires an unconnected server.',
    });
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
