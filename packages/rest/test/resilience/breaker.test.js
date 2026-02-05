import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestApp, createTestApp } from '../helpers.js';
import { ERROR_TYPES } from '../../src/errors/types.js';

/**
 * Count active timeout handles in the current process.
 *
 * Why this exists: we want to ensure breaker timeouts do not leave
 * long-running SDK timers behind after tests complete.
 *
 * @returns {number}
 */
function countTimeouts() {
  return process._getActiveHandles().filter(function isTimeout(handle) {
    return handle && handle.constructor && handle.constructor.name === 'Timeout';
  }).length;
}

/**
 * Sleep for a short duration.
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise(function waitPromise(resolve) {
    setTimeout(resolve, ms);
  });
}

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

  it('cleans up request timers', async function cleanupCase() {
    const before = countTimeouts();
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
      await app.fastify.inject({ method: 'POST', url: '/v0/slow', payload: {} });
      await app.fastify.inject({ method: 'POST', url: '/v0/slow', payload: {} });
    } finally {
      await closeTestApp(app);
    }

    await wait(25);
    const after = countTimeouts();
    assert.equal(after, before);
  });
}

describe('circuit breaker', breakerSuite);
