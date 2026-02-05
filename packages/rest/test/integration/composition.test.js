import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { attach } from '@mcp-layer/attach';
import { build } from '../../../test-server/src/index.js';
import mcpRest from '@mcp-layer/rest';

/**
 * Execute Fastify composition tests.
 * @returns {void}
 */
function compositionSuite() {
  it('composes with other Fastify plugins', async function composeCase() {
    const server = build();
    const session = await attach(server, 'test');
    const fastify = Fastify();

    try {
      await fastify.register(cors);
      await fastify.register(helmet);
      await fastify.register(mcpRest, { session });

      const res = await fastify.inject({
        method: 'OPTIONS',
        url: '/v0/openapi.json'
      });

      assert.ok(res.headers['access-control-allow-origin']);
    } finally {
      await fastify.close();
      await session.close();
      await server.close();
    }
  });
}

describe('fastify composition', compositionSuite);
