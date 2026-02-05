import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestApp, createTestApp } from '../helpers.js';
import { ERROR_TYPES } from '../../src/errors/types.js';

/**
 * Execute circuit breaker tests.
 * @returns {void}
 */
function breakerSuite() {
  it('opens after threshold failures', async function openCase() {
    const app = await createTestApp(
      {},
      {
        resilience: {
          enabled: true,
          errorThresholdPercentage: 50,
          volumeThreshold: 1,
          resetTimeout: 50,
          timeout: 10
        }
      }
    );

    try {
      const res1 = await app.fastify.inject({ method: 'POST', url: '/v0/slow', payload: {} });
      assert.equal(res1.statusCode, 500);

      const res2 = await app.fastify.inject({ method: 'POST', url: '/v0/slow', payload: {} });
      assert.equal(res2.statusCode, 503);
      assert.equal(res2.json().type, ERROR_TYPES.CIRCUIT_OPEN);
    } finally {
      await closeTestApp(app);
    }
  });

  it('can be disabled', async function disabledCase() {
    const app = await createTestApp(
      {},
      {
        resilience: { enabled: false }
      }
    );

    try {
      const res = await app.fastify.inject({
        method: 'POST',
        url: '/v0/echo',
        payload: { text: 'hello', loud: false }
      });
      assert.equal(res.statusCode, 200);
    } finally {
      await closeTestApp(app);
    }
  });
}

describe('circuit breaker', breakerSuite);
