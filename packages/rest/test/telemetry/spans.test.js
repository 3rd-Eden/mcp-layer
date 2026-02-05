import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestApp, createTestApp } from '../helpers.js';

/**
 * Execute telemetry span tests.
 * @returns {void}
 */
function spanSuite() {
  it('executes handlers with telemetry enabled', async function telemetryCase() {
    const app = await createTestApp(
      {},
      {
        telemetry: { enabled: true, serviceName: 'rest-test' }
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

describe('telemetry spans', spanSuite);
