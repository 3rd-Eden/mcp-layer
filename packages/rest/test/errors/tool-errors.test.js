import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestApp, createTestApp } from '../helpers.js';

/**
 * Execute tool error behavior tests.
 * @returns {void}
 */
function toolErrorSuite() {
  it('returns a 502 problem response for tool execution errors', async function toolErrorCase() {
    const app = await createTestApp();

    try {
      const res = await app.fastify.inject({
        method: 'POST',
        url: '/v0/fail-gracefully',
        payload: {}
      });

      assert.equal(res.statusCode, 502);
      const body = res.json();
      assert.equal(body.title, 'Tool Error');
      assert.equal(body.tool, 'fail-gracefully');
      assert.equal(body.toolError.isError, true);
      assert.equal(body.toolError.content[0].text, 'Something went wrong');
    } finally {
      await closeTestApp(app);
    }
  });

  it('returns a tool error response when a tool throws', async function protocolCase() {
    const app = await createTestApp();

    try {
      const res = await app.fastify.inject({
        method: 'POST',
        url: '/v0/crash',
        payload: {}
      });

      assert.equal(res.statusCode, 502);
      assert.equal(res.json().title, 'Tool Error');
    } finally {
      await closeTestApp(app);
    }
  });

  it('returns a policy response when guardrails deny a tool', async function guardrailCase() {
    const app = await createTestApp({}, {
      guardrails: {
        denyTools: ['echo']
      }
    });

    try {
      const res = await app.fastify.inject({
        method: 'POST',
        url: '/v0/echo',
        payload: { text: 'blocked' }
      });

      assert.equal(res.statusCode, 403);
      const body = res.json();
      assert.equal(body.code, 'GUARDRAIL_DENIED');
    } finally {
      await closeTestApp(app);
    }
  });
}

describe('tool errors vs protocol errors', toolErrorSuite);
