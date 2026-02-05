import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeMultiSessionApp, createMultiSessionApp } from '../helpers.js';

/**
 * Execute multi-session tests.
 * @returns {void}
 */
function multiSuite() {
  it('registers routes for multiple sessions', async function multiCase() {
    const app = await createMultiSessionApp([
      { name: 'one', version: '1.0.0' },
      { name: 'two', version: '2.0.0' }
    ]);

    try {
      assert.equal(app.fastify.hasRoute({ method: 'GET', url: '/v1/openapi.json' }), true);
      assert.equal(app.fastify.hasRoute({ method: 'GET', url: '/v2/openapi.json' }), true);
    } finally {
      await closeMultiSessionApp(app);
    }
  });
}

describe('multi-session integration', multiSuite);
