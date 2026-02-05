import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import { build } from '../../test-server/src/index.js';
import mcpRest from '@mcp-layer/rest';

/**
 * Execute plugin registration tests.
 * @returns {void}
 */
function pluginSuite() {
  it('registers as a Fastify plugin', async function registerCase() {
    const server = build();
    const session = await attach(server, 'test');
    const fastify = Fastify({ logger: false });

    try {
      await fastify.register(mcpRest, { session });
      assert.equal(fastify.hasRoute({ method: 'GET', url: '/v0/openapi.json' }), true);
    } finally {
      await fastify.close();
      await session.close();
      await server.close();
    }
  });

  it('requires session option', async function requiredCase() {
    const fastify = Fastify({ logger: false });

    await assert.rejects(
      async function run() {
        await fastify.register(mcpRest, {});
      },
      /session.*required/i
    );

    await fastify.close();
  });
}

describe('rest plugin', pluginSuite);
