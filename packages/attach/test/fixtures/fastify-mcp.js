import fastify from 'fastify';
import { streamableHttp } from 'fastify-mcp';
import { build as buildServer } from '@mcp-layer/test-server';

/**
 * Create the SDK server used by the Fastify Streamable HTTP route.
 * @returns {import('@modelcontextprotocol/sdk/server/index.js').Server} MCP SDK server.
 */
function createServer() {
  return buildServer({ info: { name: 'fastify-fixture', version: '0.0.0' } }).server;
}

/**
 * Build a Fastify app with a real MCP Streamable HTTP endpoint.
 * @param {{ requests?: Record<string, string | string[] | undefined>[] }} [opts] - Optional request-header capture for transport scenarios.
 * @returns {Promise<import('fastify').FastifyInstance>} Fastify app with the endpoint registered.
 */
export async function build(opts = {}) {
  const app = fastify({ logger: false });
  if (Array.isArray(opts.requests)) {
    app.addHook('onRequest', async function capture(request) {
      opts.requests.push({ method: request.method, ...request.headers });
    });
  }
  await app.register(streamableHttp, {
    stateful: false,
    mcpEndpoint: '/mcp',
    createServer
  });

  await app.ready();
  return app;
}
