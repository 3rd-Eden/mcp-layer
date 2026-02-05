import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestApp, createTestApp } from '../helpers.js';

/**
 * Execute circuit breaker recovery tests.
 * @returns {void}
 */
function recoverySuite() {
  it('recovers after reset timeout', async function recoveryCase() {
    const app = await createTestApp(
      {},
      {
        resilience: {
          enabled: true,
          errorThresholdPercentage: 50,
          volumeThreshold: 1,
          resetTimeout: 20,
          timeout: 1000
        }
      }
    );

    try {
      await app.fastify.inject({ method: 'POST', url: '/v0/flap', payload: {} });
      await new Promise(function wait(resolve) {
        setTimeout(resolve, 30);
      });
      const res = await app.fastify.inject({ method: 'POST', url: '/v0/flap', payload: {} });
      assert.equal(res.statusCode, 200);
    } finally {
      await closeTestApp(app);
    }
  });
}

describe('circuit breaker recovery', recoverySuite);
