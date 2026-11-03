import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Session } from '@mcp-layer/session';
import { createRequire } from 'node:module';

const read = createRequire(import.meta.url);
const pkg = read('../../package.json');
const base = {
  name: 'mcp-layer',
  version: typeof pkg.version === 'string' ? pkg.version : '0.0.0'
};

const framing = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

/**
 * Copy caller context headers that do not control HTTP framing or MCP protocol negotiation.
 * @param {Record<string, string>} input - Caller-supplied static request headers to copy.
 * @returns {Readonly<Record<string, string>>} Immutable context headers.
 */
function copyHeaders(input) {
  return Object.freeze(Object.fromEntries(
    Object.entries(input).filter(function context([name]) {
      const key = name.toLowerCase();
      // The SDK must set content and MCP protocol headers for each request it sends.
      return !key.startsWith('content-') && !key.startsWith('mcp-') && key !== 'accept' && !framing.has(key);
    })
  ));
}

/**
 * Determine whether the instance is a Fastify app with in-process injection support.
 * @param {unknown} instance - Candidate server instance.
 * @returns {boolean} True when the instance exposes Fastify readiness and injection methods.
 */
export function isFastifyInstance(instance) {
  if (instance === null || typeof instance !== 'object') return false;
  return typeof instance.ready === 'function' && typeof instance.inject === 'function';
}

/**
 * Route SDK HTTP requests through Fastify's injector without opening a socket.
 * @param {import('fastify').FastifyInstance} app - Fastify app with an MCP Streamable HTTP endpoint.
 * @returns {NonNullable<import('@modelcontextprotocol/sdk/client/streamableHttp.js').StreamableHTTPClientTransportOptions['fetch']>} Fetch adapter for the SDK transport.
 */
function createFetch(app) {
  /**
   * Send one SDK request through Fastify injection.
   * @param {string | URL} input - SDK request URL.
   * @param {RequestInit} [init] - Request method, headers, and body.
   * @returns {Promise<Response>} Fetch response with Fastify's status, headers, and body.
   */
  return async function inject(input, init = {}) {
    const url = new URL(input);
    const response = await app.inject({
      method: init.method ?? 'GET',
      url: `${url.pathname}${url.search}`,
      payload: init.body ?? undefined,
      headers: Object.fromEntries(new Headers(init.headers).entries())
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(response.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(name, item);
        continue;
      }
      headers.set(name, value);
    }
    const body = response.body.length === 0 ? null : response.body;
    return new Response(body, {
      status: response.statusCode,
      statusText: response.statusMessage,
      headers
    });
  };
}

/**
 * Attach to a Fastify app that serves an MCP endpoint and return a Session.
 * @param {import('fastify').FastifyInstance} app - Fastify app with an MCP Streamable HTTP endpoint.
 * @param {string} name - Human-readable session name used in the Session metadata.
 * @param {{ info?: { name: string, version: string }, source?: string, path?: string, headers?: Record<string, string> }} [opts] - Optional settings: client identity in `info`, session source in `source`, MCP path in `path`, and static caller headers in `headers`.
 * @returns {Promise<Session>} Session connected to the in-process MCP endpoint with a client and transport.
 */
export async function attachFastify(app, name, opts = {}) {
  await app.ready();

  const info = { ...base, ...(opts.info ?? {}) };
  const path = typeof opts.path === 'string' && opts.path.length > 0 ? opts.path : '/mcp';
  const headers = copyHeaders(opts.headers ?? {});
  const transport = new StreamableHTTPClientTransport(new URL(path, 'http://mcp-layer.local'), {
    fetch: createFetch(app),
    requestInit: { headers }
  });
  const client = new Client(info);

  await client.connect(transport);

  return new Session({
    name,
    source: opts.source ?? 'fastify',
    entry: null,
    client,
    transport,
    info
  });
}
