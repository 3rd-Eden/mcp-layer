import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from '@mcp-layer/test-server';
import { extract } from '@mcp-layer/schema';
import { attach, Session } from '@mcp-layer/attach';
import { build as buildPlatformatic } from './fixtures/platformatic.js';

const fixtures = new URL('./fixtures/', import.meta.url);

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

  it('forwards immutable headers on every Platformatic MCP request', async function headersCase(t) {
    const values = JSON.parse(await readFile(fileURLToPath(new URL('headers.json', fixtures)), 'utf8'));
    const requests = [];
    const app = await buildPlatformatic({ requests });
    const headers = { ...values.headers };
    const session = await attach(app, 'platformatic', { headers });

    t.after(async function afterPlatformatic() {
      await session.close();
      await app.close();
    });

    headers.authorization = 'Bearer changed-after-attach';
    await extract(session);

    assert.ok(requests.length >= 2);
    assert.deepEqual(
      requests.map(function authorization(request) {
        return request.authorization;
      }),
      Array.from({ length: requests.length }, function original() {
        return values.headers.authorization;
      })
    );
    assert.deepEqual(
      requests.map(function contentType(request) {
        return request['content-type'];
      }),
      Array.from({ length: requests.length }, function json() {
        return 'application/json';
      })
    );
    assert.ok(requests.every(function contentLength(request) {
      return Number(request['content-length']) > Number(values.headers['content-length']);
    }));
    assert.ok(requests.every(function connection(request) {
      return request.connection === undefined;
    }));
  });
});
