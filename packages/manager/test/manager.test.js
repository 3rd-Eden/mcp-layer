import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import { build } from '@mcp-layer/test-server';
import { createManager } from '../src/index.js';
import { LayerError } from '@mcp-layer/error';

/**
 * Build a new MCP session for a given identity.
 * @param {string} identity - Identity key.
 * @param {{ servers: Array<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>, count: number }} state - Factory state.
 * @returns {Promise<import('@mcp-layer/session').Session>}
 */
async function create(identity, state) {
  state.count += 1;
  const server = build();
  state.servers.push(server);
  return attach(server, `session-${identity}-${state.count}`);
}

/**
 * Create a Fastify instance that calls a session manager.
 * @param {ReturnType<typeof createManager>} manager - Session manager.
 * @returns {import('fastify').FastifyInstance}
 */
function createApp(manager) {
  const app = Fastify({ logger: false });

  /**
   * Handle proxy calls for testing.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @param {import('fastify').FastifyReply} reply - Fastify reply.
   * @returns {Promise<void>}
   */
  async function handler(request, reply) {
    const session = await manager.get(request);
    reply.code(200).send({ name: session.name });
  }

  app.get('/proxy', handler);
  return app;
}

/**
 * Close a manager and all test servers.
 * @param {ReturnType<typeof createManager>} manager - Session manager.
 * @param {Array<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>} servers - Servers to close.
 * @returns {Promise<void>}
 */
async function cleanup(manager, servers) {
  await manager.close();
  for (const server of servers) {
    await server.close();
  }
}

/**
 * Execute session manager tests.
 * @returns {void}
 */
function suite() {
  it('reuses shared sessions when auth is optional', async function reuseCase() {
    const state = { servers: [], count: 0 };
    const manager = createManager({
      max: 2,
      ttl: 60000,
      factory: async function factory(ctx) {
        return create(ctx.identity, state);
      }
    });
    const app = createApp(manager);

    try {
      const first = await app.inject({ method: 'GET', url: '/proxy' });
      const second = await app.inject({ method: 'GET', url: '/proxy' });

      const firstBody = first.json();
      const secondBody = second.json();

      assert.equal(firstBody.name, secondBody.name);
      assert.equal(state.count, 1);
    } finally {
      await app.close();
      await cleanup(manager, state.servers);
    }
  });

  it('creates distinct sessions per bearer token', async function perTokenCase() {
    const state = { servers: [], count: 0 };
    const manager = createManager({
      max: 3,
      ttl: 60000,
      factory: async function factory(ctx) {
        return create(ctx.identity, state);
      }
    });
    const app = createApp(manager);

    try {
      const one = await app.inject({
        method: 'GET',
        url: '/proxy',
        headers: { authorization: 'Bearer token-a' }
      });
      const two = await app.inject({
        method: 'GET',
        url: '/proxy',
        headers: { authorization: 'Bearer token-b' }
      });
      const three = await app.inject({
        method: 'GET',
        url: '/proxy',
        headers: { authorization: 'Bearer token-a' }
      });

      const oneBody = one.json();
      const twoBody = two.json();
      const threeBody = three.json();

      assert.notEqual(oneBody.name, twoBody.name);
      assert.equal(oneBody.name, threeBody.name);
      assert.equal(state.count, 2);
    } finally {
      await app.close();
      await cleanup(manager, state.servers);
    }
  });

  it('evicts the least recently used session when max is exceeded', async function evictionCase() {
    const state = { servers: [], count: 0 };
    const manager = createManager({
      max: 2,
      ttl: 60000,
      factory: async function factory(ctx) {
        return create(ctx.identity, state);
      }
    });
    const app = createApp(manager);

    try {
      await app.inject({
        method: 'GET',
        url: '/proxy',
        headers: { authorization: 'Bearer token-a' }
      });
      await app.inject({
        method: 'GET',
        url: '/proxy',
        headers: { authorization: 'Bearer token-b' }
      });
      await app.inject({
        method: 'GET',
        url: '/proxy',
        headers: { authorization: 'Bearer token-c' }
      });

      const stats = manager.stats();
      assert.equal(stats.size, 2);
      assert.equal(stats.evictions, 1);
      assert.deepEqual(stats.keys.sort(), ['bearer:token-b', 'bearer:token-c']);
    } finally {
      await app.close();
      await cleanup(manager, state.servers);
    }
  });

  it('recreates sessions after TTL expiry', async function ttlCase() {
    const state = { servers: [], count: 0 };
    let now = 1000;
    const manager = createManager({
      max: 2,
      ttl: 50,
      now: function nowFn() {
        return now;
      },
      factory: async function factory(ctx) {
        return create(ctx.identity, state);
      }
    });
    const app = createApp(manager);

    try {
      const first = await app.inject({
        method: 'GET',
        url: '/proxy',
        headers: { authorization: 'Bearer token-a' }
      });
      now += 100;
      const second = await app.inject({
        method: 'GET',
        url: '/proxy',
        headers: { authorization: 'Bearer token-a' }
      });

      const firstBody = first.json();
      const secondBody = second.json();

      assert.notEqual(firstBody.name, secondBody.name);
      assert.equal(state.count, 2);
    } finally {
      await app.close();
      await cleanup(manager, state.servers);
    }
  });

  it('creates documented auth errors with source context', async function errorCase() {
    const manager = createManager({
      auth: { mode: 'required' },
      factory: async function factory() {
        throw new Error('factory should not execute');
      }
    });

    try {
      await assert.rejects(
        function rejectCase() {
          return manager.get({ headers: {} });
        },
        function match(error) {
          assert.ok(error instanceof LayerError);
          assert.equal(error.code, 'AUTH_REQUIRED');
          assert.equal(error.package, '@mcp-layer/manager');
          assert.equal(error.method, 'identity');
          assert.match(error.docs, /packages\/manager\/README\.md#error-[a-f0-9]{6}$/);
          return true;
        }
      );
    } finally {
      await manager.close();
    }
  });
}

describe('session manager', suite);
