import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { load } from '@mcp-layer/config';
import { connect, Session } from '../src/index.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const base = path.join(fixtures, 'config.json');
const read = createRequire(import.meta.url);
const serverpkg = read.resolve('@mcp-layer/test-server/package.json');
const entry = path.join(path.dirname(serverpkg), 'src', 'bin.js');

/**
 * Create a temporary directory for connector tests.
 * @returns {Promise<string>}
 */
async function tempdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mcp-layer-connect-'));
}

/**
 * Materialise a config file derived from the base fixture.
 * @param {string} dir
 * @returns {Promise<string>}
 */
async function copyconfig(dir) {
  const file = path.join(dir, 'mcp.json');
  await fs.copyFile(base, file);
  return file;
}

/**
 * Apply runtime command details to the copied config.
 * @param {string} file
 * @returns {Promise<void>}
 */
async function hydrateconfig(file) {
  const raw = await fs.readFile(file, 'utf8');
  const data = JSON.parse(raw);
  data.servers.demo.command = process.execPath;
  data.servers.demo.args = [entry];
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

describe('connect', function connectSuite() {
  describe('connect', function connectMethodSuite() {
    it('spawns stdio server and completes handshake', async function connectHandshakeCase(t) {
      const dir = await tempdir();
      const file = await copyconfig(dir);
      await hydrateconfig(file);

      const cfg = await load(undefined, dir);
      const link = await connect(cfg, 'demo');

      t.after(async function cleanup() {
        await link.close();
      });

      assert.equal(link instanceof Session, true);
      const status = await link.client.ping();
      assert.equal(typeof status, 'object');
      assert.equal(link.transport.pid !== null, true);
      assert.equal(link.source, file);
      assert.equal(link.name, 'demo');
    });
  });
});
