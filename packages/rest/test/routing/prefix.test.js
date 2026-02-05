import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestApp, createTestApp } from '../helpers.js';

/**
 * Execute prefix tests.
 * @returns {void}
 */
function prefixSuite() {
  it('passes version, serverInfo, and sessionName', async function argsCase() {
    const received = { value: null };

    function prefix(version, serverInfo, sessionName) {
      received.value = { version, serverInfo, sessionName };
      return `/custom/${version}`;
    }

    const app = await createTestApp(
      { name: 'my-server', version: '2.3.4' },
      { prefix }
    );

    try {
      assert.equal(received.value.version, 'v2');
      assert.equal(received.value.serverInfo.version, '2.3.4');
      assert.equal(received.value.sessionName, 'my-server');
      assert.equal(app.fastify.hasRoute({ method: 'GET', url: '/custom/v2/openapi.json' }), true);
    } finally {
      await closeTestApp(app);
    }
  });

  it('supports multi-tenant prefixes', async function tenantCase() {
    function prefix(version) {
      return `/api/tenant-123/mcp/${version}`;
    }

    const app = await createTestApp(
      { name: 'tenant-api', version: '1.0.0' },
      { prefix }
    );

    try {
      assert.equal(app.fastify.hasRoute({ method: 'GET', url: '/api/tenant-123/mcp/v1/openapi.json' }), true);
    } finally {
      await closeTestApp(app);
    }
  });
}

describe('custom prefix function', prefixSuite);
