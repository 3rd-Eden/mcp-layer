import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import { build } from '@mcp-layer/test-server';
import { createManager } from '@mcp-layer/manager';
import mcpRest from '@mcp-layer/rest';
import { ERROR_TYPES } from '../src/errors/types.js';

/**
 * Create a catalog session for REST routing.
 * @param {Array<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>} servers - Server list to populate.
 * @returns {Promise<import('@mcp-layer/session').Session>}
 */
async function createCatalogSession(servers) {
  const server = build({ info: { name: 'catalog', version: '1.0.0' } });
  servers.push(server);
  return attach(server, 'catalog');
}

/**
 * Create a session factory with real MCP servers.
 * @param {{ servers: Array<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>, count: number }} state - Factory state.
 * @returns {(ctx: { identity: { key: string } }) => Promise<import('@mcp-layer/session').Session>}
 */
function createFactory(state) {
  /**
   * Build a new session.
   * @param {{ identity: { key: string } }} ctx - Session context.
   * @returns {Promise<import('@mcp-layer/session').Session>}
   */
  async function factory(ctx) {
    state.count += 1;
    const server = build();
    state.servers.push(server);
    return attach(server, `session-${ctx.identity.key}-${state.count}`);
  }

  return factory;
}

/**
 * Close all servers.
 * @param {Array<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>} servers - Servers to close.
 * @returns {Promise<void>}
 */
async function closeServers(servers) {
  for (const server of servers) {
    await server.close();
  }
}

/**
 * Execute session manager integration tests.
 * @returns {void}
 */
function suite() {
  it('routes requests through the session manager', async function managerCase() {
    const state = { servers: [], count: 0 };
    const catalogSession = await createCatalogSession(state.servers);
    const manager = createManager({
      max: 5,
      ttl: 60000,
      factory: createFactory(state)
    });
    const app = Fastify({ logger: false });

    await app.register(mcpRest, {
      session: catalogSession,
      manager: manager
    });

    try {
      const resA = await app.inject({
        method: 'POST',
        url: '/v1/echo',
        payload: { text: 'hi', loud: false },
        headers: { authorization: 'Bearer token-a' }
      });
      const resB = await app.inject({
        method: 'POST',
        url: '/v1/echo',
        payload: { text: 'hi', loud: false },
        headers: { authorization: 'Bearer token-b' }
      });

      assert.equal(resA.statusCode, 200);
      assert.equal(resB.statusCode, 200);
      assert.equal(state.count, 2);
    } finally {
      await app.close();
      await manager.close();
      await closeServers(state.servers);
    }
  });

  it('returns a 401 when auth is required', async function authCase() {
    const state = { servers: [], count: 0 };
    const catalogSession = await createCatalogSession(state.servers);
    const manager = createManager({
      max: 2,
      ttl: 60000,
      auth: { mode: 'required' },
      factory: createFactory(state)
    });
    const app = Fastify({ logger: false });

    await app.register(mcpRest, {
      session: catalogSession,
      manager: manager
    });

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/echo',
        payload: { text: 'hi', loud: false }
      });

      const body = res.json();
      assert.equal(res.statusCode, 401);
      assert.equal(body.type, ERROR_TYPES.AUTH);
    } finally {
      await app.close();
      await manager.close();
      await closeServers(state.servers);
    }
  });
}

describe('session manager integration', suite);
