import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { load } from '@mcp-layer/config';
import { connect, Session, setup } from '../src/index.js';
import { startHttpServer } from '@mcp-layer/test-server/http';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const base = path.join(fixtures, 'config.json');
const read = createRequire(import.meta.url);
const serverpkg = read.resolve('@mcp-layer/test-server/package.json');
const stdioEntry = path.join(path.dirname(serverpkg), 'src', 'bin.js');
const idleEntry = path.join(fixtures, 'idle-server.mjs');

/**
 * Create a temporary directory for connector tests.
 * @returns {Promise<string>}
 */
async function tempdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mcp-layer-connect-'));
}

/**
 * Sleep for a short interval to allow async cleanup to settle.
 * @param {number} ms - Delay in milliseconds.
 * @returns {Promise<void>}
 */
async function sleep(ms) {
  return new Promise(function sleepExecutor(resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Read the fixture child process id from disk with retries.
 * @param {string} file - File path written by the idle fixture.
 * @param {number} [tries=100] - Number of read attempts before giving up.
 * @returns {Promise<number | undefined>}
 */
async function readpid(file, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const raw = await fs.readFile(file, 'utf8');
      const pid = Number.parseInt(raw.trim(), 10);
      if (Number.isInteger(pid) && pid > 0) return pid;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'ENOENT') throw error;
    }

    await sleep(20);
  }

  return undefined;
}

/**
 * Check whether a process id is still alive.
 * @param {number} pid - Process id to probe.
 * @returns {boolean}
 */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * Wait for a process to stop after timeout cleanup.
 * @param {number} pid - Process id to observe.
 * @param {number} [tries=100] - Number of retry checks before failing.
 * @returns {Promise<boolean>}
 */
async function waitstop(pid, tries = 100) {
  for (let i = 0; i < tries; i += 1) {
    if (!alive(pid)) return true;
    await sleep(20);
  }

  return false;
}

/**
 * Materialise a config file derived from the base fixture.
 * @param {string} dir - Temporary directory to receive the config file.
 * @returns {Promise<string>}
 */
async function copyconfig(dir) {
  const file = path.join(dir, 'mcp.json');
  await fs.copyFile(base, file);
  return file;
}

/**
 * Apply runtime command details to the copied config.
 * @param {string} file - Path to the config file to update.
 * @returns {Promise<void>}
 */
async function hydrateconfig(file) {
  const raw = await fs.readFile(file, 'utf8');
  const data = JSON.parse(raw);
  data.servers.demo.command = process.execPath;
  data.servers.demo.args = [stdioEntry];
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Start the HTTP transport test server for local integration tests.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
async function spawntestserver() {
  const server = await startHttpServer({ port: 0 });
  return {
    close: server.close,
    url: `http://127.0.0.1:${server.port}`
  };
}

/**
 * Build an HTTP-oriented config file for transport integration tests.
 * @param {string} dir - Temp directory to write config in.
 * @param {string} url - Endpoint URL for the mounted test server.
 * @returns {Promise<string>}
 */
async function httpconfig(dir, url) {
  const file = path.join(dir, 'mcp.json');
  const config = {
    type: 'http',
    url
  };

  const data = { servers: { demo: config } };
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return file;
}

/**
 * Build a stdio config for a non-responsive server entry.
 * @param {string} dir - Temp directory to write config in.
 * @param {string} [pid] - Optional file path where the fixture should record its pid.
 * @returns {Promise<string>}
 */
async function idleconfig(dir, pid) {
  const file = path.join(dir, 'mcp.json');
  const config = {
    command: process.execPath,
    args: pid ? [idleEntry, pid] : [idleEntry]
  };

  const data = { servers: { demo: config } };
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return file;
}

describe('connect', function connectSuite() {
  describe('setup', function setupSuite() {
    it('inherits process env values and keeps override precedence', function setupEnvCase() {
      const key = 'MCP_LAYER_CONNECT_SETUP_ENV';
      const passthrough = 'MCP_LAYER_CONNECT_SETUP_PROCESS_ONLY';
      const prev = process.env[key];
      const prevPassthrough = process.env[passthrough];
      process.env[key] = 'from-process';
      process.env[passthrough] = 'process-only';

      try {
        const entry = {
          name: 'demo',
          source: '/tmp/mcp.json',
          config: {
            command: process.execPath,
            env: {
              [key]: 'from-config',
              FROM_CONFIG: '1'
            }
          }
        };

        const out = setup(entry, {
          env: {
            [key]: 'from-opts',
            FROM_OPTS: '1'
          }
        });

        assert.equal(out.env[key], 'from-opts');
        assert.equal(out.env.FROM_CONFIG, '1');
        assert.equal(out.env.FROM_OPTS, '1');
        assert.equal(out.env[passthrough], 'process-only');
      } finally {
        if (prev === undefined) delete process.env[key];
        else process.env[key] = prev;
        if (prevPassthrough === undefined) delete process.env[passthrough];
        else process.env[passthrough] = prevPassthrough;
      }
    });
  });

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
      assert.equal(link.transport.constructor?.name, 'StdioClientTransport');
    });

    it('connects to mounted streamable HTTP server over localhost', async function connectHttpCase(t) {
      const server = await spawntestserver();
      t.after(async function cleanupServer() {
        await server.close();
      });

      const dir = await tempdir();
      const file = await httpconfig(dir, `${server.url}/mcp`);
      const cfg = await load(undefined, dir);
      const link = await connect(cfg, 'demo');

      t.after(async function cleanup() {
        await link.close();
      });

      assert.equal(link instanceof Session, true);
      const status = await link.client.ping();
      assert.equal(typeof status, 'object');
      assert.equal(link.transport.constructor?.name, 'StreamableHTTPClientTransport');
      assert.equal(link.source, file);
      assert.equal(link.name, 'demo');
    });

    it('auto-selects streamable HTTP when URL config is provided', async function connectAutoHttpCase(t) {
      const server = await spawntestserver();
      t.after(async function cleanupServer() {
        await server.close();
      });

      const dir = await tempdir();
      const file = await httpconfig(dir, `${server.url}/mcp`);
      const cfg = await load(undefined, dir);
      const link = await connect(cfg, 'demo');

      t.after(async function cleanup() {
        await link.close();
      });

      assert.equal(link instanceof Session, true);
      const status = await link.client.ping();
      assert.equal(typeof status, 'object');
      assert.equal(link.transport.constructor?.name, 'StreamableHTTPClientTransport');
      assert.equal(link.source, file);
      assert.equal(link.name, 'demo');
    });

    it('connects to mounted SSE server over localhost', async function connectSseCase(t) {
      const server = await spawntestserver();
      t.after(async function cleanupServer() {
        await server.close();
      });

      const dir = await tempdir();
      const file = await httpconfig(dir, `${server.url}/sse`);
      const cfg = await load(undefined, dir);
      const link = await connect(cfg, 'demo', { transport: 'sse' });

      t.after(async function cleanup() {
        await link.close();
      });

      assert.equal(link instanceof Session, true);
      const status = await link.client.ping();
      assert.equal(typeof status, 'object');
      assert.equal(link.transport.constructor?.name, 'SSEClientTransport');
      assert.equal(link.source, file);
      assert.equal(link.name, 'demo');
    });

    it('times out when the server never completes initialization', async function connectTimeoutCase() {
      const dir = await tempdir();
      const pid = path.join(dir, 'idle.pid');
      await idleconfig(dir, pid);

      const cfg = await load(undefined, dir);
      const started = Date.now();

      try {
        await connect(cfg, 'demo', { timeout: 200 });
        throw new Error('Expected connect to time out.');
      } catch (error) {
        const elapsed = Date.now() - started;
        const message = error instanceof Error ? error.message : String(error);
        assert.equal(message.includes('Timed out while connecting to server "demo"'), true);
        assert.equal(elapsed < 5000, true);
      }

      const child = await readpid(pid);
      assert.equal(typeof child, 'number');
      assert.equal(Number.isInteger(child), true);
      assert.equal(await waitstop(child), true);
    });
  });
});
