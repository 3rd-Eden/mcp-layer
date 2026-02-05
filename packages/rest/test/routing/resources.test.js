import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestApp, createTestApp } from '../helpers.js';

/**
 * Execute resource routing tests.
 * @returns {void}
 */
function resourceSuite() {
  it('reads resources via GET /{resourcePath}', async function resourceCase() {
    const app = await createTestApp();

    try {
      const res = await app.fastify.inject({
        method: 'GET',
        url: '/v0/resource/manual/_'
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.includes('# MCP Test Server Manual'), true);
    } finally {
      await closeTestApp(app);
    }
  });
}

describe('resource routing', resourceSuite);
