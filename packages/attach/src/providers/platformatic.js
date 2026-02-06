import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Session } from '@mcp-layer/session';
import { createRequire } from 'node:module';

const read = createRequire(import.meta.url);
const pkg = read('../../package.json');
const base = {
  name: 'mcp-layer',
  version: typeof pkg.version === 'string' ? pkg.version : '0.0.0'
};

/**
 * Determine whether the instance looks like a Platformatic MCP Fastify server.
 * @param {unknown} instance - Candidate server instance.
 * @returns {boolean}
 */
export function isPlatformaticInstance(instance) {
  if (!instance || typeof instance !== 'object') return false;
  return typeof instance.mcpAddTool === 'function' && typeof instance.inject === 'function';
}

/**
 * Transport that sends MCP JSON-RPC messages through Fastify's inject API.
 * @class
 */
class FastifyInjectTransport {
  /**
   * Create a transport bound to a Fastify instance.
   * @param {import('fastify').FastifyInstance} app - Fastify instance with the MCP plugin registered.
   * @param {string} url - URL path for the MCP endpoint.
   */
  constructor(app, url) {
    this.app = app;
    this.url = url;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;
    this.active = false;
  }

  /**
   * Start the transport lifecycle.
   * @returns {Promise<void>}
   */
  async start() {
    this.active = true;
  }

  /**
   * Send a JSON-RPC message to the Fastify MCP endpoint.
   * @param {object | object[]} message - JSON-RPC message or batch.
   * @returns {Promise<void>}
   */
  async send(message) {
    if (!this.active) throw new Error('Transport is not started.');

    try {
      const response = await this.app.inject({
        method: 'POST',
        url: this.url,
        payload: JSON.stringify(message),
        headers: { 'content-type': 'application/json' }
      });
      await this.handleResponse(response);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Close the transport lifecycle.
   * @returns {Promise<void>}
   */
  async close() {
    this.active = false;
    if (typeof this.onclose === 'function') this.onclose();
  }

  /**
   * Handle an inject response by emitting JSON-RPC messages.
   * @param {import('fastify').LightMyRequestResponse} response - Inject response.
   * @returns {Promise<void>}
   */
  async handleResponse(response) {
    if (!response || response.statusCode === 204) return;

    const body = response.body;
    if (!body) return;

    const payload = this.parseBody(body);
    if (!payload) return;

    if (Array.isArray(payload)) {
      this.emitBatch(payload);
      return;
    }
    this.emitMessage(payload);
  }

  /**
   * Parse a JSON body string into an object.
   * @param {string} body - Raw JSON response body.
   * @returns {object | object[] | null}
   */
  parseBody(body) {
    try {
      return JSON.parse(body);
    } catch (error) {
      this.handleError(error);
      return null;
    }
  }

  /**
   * Emit a batch of JSON-RPC messages.
   * @param {object[]} batch - JSON-RPC response batch.
   * @returns {void}
   */
  emitBatch(batch) {
    for (const item of batch) {
      this.emitMessage(item);
    }
  }

  /**
   * Emit a single JSON-RPC message.
   * @param {object} message - JSON-RPC response.
   * @returns {void}
   */
  emitMessage(message) {
    if (typeof this.onmessage === 'function') this.onmessage(message);
  }

  /**
   * Forward an error to the transport error handler.
   * @param {unknown} error - Error to forward.
   * @returns {void}
   */
  handleError(error) {
    if (typeof this.onerror === 'function') this.onerror(error);
  }
}

/**
 * Attach to a Platformatic MCP Fastify server instance and return a Session.
 * @param {import('fastify').FastifyInstance} app - Fastify instance with MCP plugin registered.
 * @param {string} name - Human-readable session name used in the Session metadata.
 * @param {{ info?: { name: string, version: string }, source?: string, path?: string }} [opts] - Optional client metadata, source, and endpoint overrides.
 * @returns {Promise<Session>}
 */
export async function attachPlatformatic(app, name, opts = {}) {
  if (typeof app.ready === 'function') await app.ready();

  const info = { ...base, ...(opts.info ?? {}) };
  const url = typeof opts.path === 'string' && opts.path.length > 0 ? opts.path : '/mcp';
  const transport = new FastifyInjectTransport(app, url);
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
