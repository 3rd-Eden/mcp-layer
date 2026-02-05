import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestApp, createTestApp } from '../helpers.js';
import { ERROR_TYPES } from '../../src/errors/types.js';

/**
 * Execute tool routing tests.
 * @returns {void}
 */
function toolSuite() {
  it('invokes tool handlers via POST /{toolName}', async function toolCase() {
    const app = await createTestApp();

    try {
      const res = await app.fastify.inject({
        method: 'POST',
        url: '/v0/echo',
        payload: { text: 'hello', loud: false }
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.json().content[0].text, 'hello');
    } finally {
      await closeTestApp(app);
    }
  });

  it('rejects invalid tool input', async function invalidCase() {
    const app = await createTestApp();

    try {
      const res = await app.fastify.inject({
        method: 'POST',
        url: '/v0/echo',
        payload: {}
      });

      assert.equal(res.statusCode, 400);
      assert.equal(res.json().type, ERROR_TYPES.VALIDATION);
    } finally {
      await closeTestApp(app);
    }
  });
}

describe('tool routing', toolSuite);
