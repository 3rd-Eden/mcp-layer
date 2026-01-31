import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '@mcp-layer/test-server';
import { attach, Session } from '../src/index.js';

/**
 * Create a test server instance.
 * @returns {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer}
 */
function maketarget() {
  return build();
}

describe('attach', function attachSuite() {
  it('attaches to an in-process server and returns a Session', async function attachCase() {
    const server = maketarget();
    const session = await attach(server, 'demo');

    try {
      assert.equal(session instanceof Session, true);
      const status = await session.client.ping();
      assert.equal(typeof status, 'object');
    } finally {
      await session.close();
    }
  });

  it('throws when server is already connected', async function connectedCase() {
    const server = maketarget();
    const first = await attach(server, 'demo');

    try {
      await assert.rejects(async function run() {
        await attach(server, 'demo');
      }, /already connected/);
    } finally {
      await first.close();
    }
  });
});
