import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { build } from '@mcp-layer/test-server';
import { extract } from '@mcp-layer/schema';
import { attach, Session } from '../src/index.js';
import { build as buildPlatformatic } from './fixtures/platformatic.js';

/**
 * Create a test server instance.
 * @returns {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer}
 */
function maketarget() {
  return build();
}

/**
 * Find a schema item by type and name.
 * @param {import('@mcp-layer/schema').SchemaOutput} output - Schema extraction output.
 * @param {string} type - Item type to locate.
 * @param {string} name - Item name to locate.
 * @returns {import('@mcp-layer/schema').SchemaItem | undefined}
 */
function findItem(output, type, name) {
  return output.items.find(function match(item) {
    return item.type === type && item.name === name;
  });
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

  it('attaches to a Platformatic MCP Fastify instance and extracts schema', async function platformaticCase(t) {
    const app = await buildPlatformatic();
    const session = await attach(app, 'platformatic');

    t.after(async function afterPlatformatic() {
      await session.close();
      await app.close();
    });

    const output = await extract(session);
    const tool = findItem(output, 'tool', 'sum');
    const resource = findItem(output, 'resource', 'config');
    const prompt = findItem(output, 'prompt', 'review');

    assert.ok(tool);
    assert.ok(resource);
    assert.ok(prompt);
    assert.equal(output.server.info?.name, 'platformatic-fixture');
  });
});
