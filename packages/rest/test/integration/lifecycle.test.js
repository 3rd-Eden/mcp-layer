import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import { build } from '../../../test-server/src/index.js';
import mcpRest from '@mcp-layer/rest';

/**
 * Execute lifecycle tests.
 * @returns {void}
 */
function lifecycleSuite() {
  it('does not close sessions on Fastify shutdown', async function closeCase() {
    const server = build();
    const session = await attach(server, 'test');
    const fastify = Fastify({ logger: false });

    try {
      await fastify.register(mcpRest, { session });
      await fastify.close();
      const res = await session.client.ping();
      assert.equal(typeof res, 'object');
    } finally {
      await session.close();
      await server.close();
    }
  });
}

describe('plugin lifecycle', lifecycleSuite);
