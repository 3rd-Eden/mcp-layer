import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { connect } from '@mcp-layer/connect';
import mcpRest from '@mcp-layer/rest';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(here), '..', '..', '..', '..');
const bin = path.join(root, 'packages', 'test-server', 'src', 'bin.js');

/**
 * Build a config map compatible with @mcp-layer/connect for the test server.
 *
 * against the real test-server binary.
 *
 * @returns {Map<string, { name: string, source: string, config: Record<string, unknown> }>}
 */
function createConfig() {
  const cfg = new Map();
  cfg.set('rest-e2e', {
    name: 'rest-e2e',
    source: here,
    config: {
      command: process.execPath,
      args: [bin]
    }
  });
  return cfg;
}

/**
 * Start a Fastify server with the REST plugin and return its base URL.
 *
 *
 * @param {import('@mcp-layer/session').Session} session - MCP session to expose.
 * @returns {Promise<{ fastify: import('fastify').FastifyInstance, base: string }>}
 */
async function startServer(session) {
  const fastify = Fastify({ logger: false });
  await fastify.register(mcpRest, { session });
  await fastify.listen({ port: 0, host: '127.0.0.1' });
  const addr = fastify.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { fastify, base: `http://127.0.0.1:${port}` };
}

/**
 * Perform a JSON POST request.
 *
 *
 * @param {string} url - Target URL.
 * @param {Record<string, unknown>} payload - JSON payload.
 * @returns {Promise<{ status: number, body: Record<string, unknown> }>}
 */
async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.json();
  return { status: res.status, body };
}

/**
 * Perform a text GET request.
 *
 *
 * @param {string} url - Target URL.
 * @returns {Promise<{ status: number, body: string }>}
 */
async function getText(url) {
  const res = await fetch(url);
  const body = await res.text();
  return { status: res.status, body };
}

/**
 * Execute real network integration tests for the REST plugin.
 *
 * @returns {void}
 */
function httpSuite() {
  it('serves tools, prompts, and resources over HTTP', async function httpCase(test) {
    const config = createConfig();
    const session = await connect(config, 'rest-e2e');
    let app;

    try {
      try {
        app = await startServer(session);
      } catch (error) {
        const runtimeError = /** @type {Error & { code?: string }} */ (error);
        if (runtimeError.code === 'EPERM') {
          test.skip('Network listen is not permitted in this environment.');
          return;
        }

        throw runtimeError;
      }

      const tool = await postJson(`${app.base}/v0/echo`, { text: 'hello', loud: false });
      assert.equal(tool.status, 200);
      assert.equal(tool.body.content[0].text, 'hello');

      const prompt = await postJson(`${app.base}/v0/prompts/welcome`, { name: 'Ada', tone: 'cheerful' });
      assert.equal(prompt.status, 200);
      assert.equal(prompt.body.messages[0].content.text.includes('Ada'), true);

      const resource = await getText(`${app.base}/v0/resource/manual/_`);
      assert.equal(resource.status, 200);
      assert.equal(resource.body.includes('# MCP Test Server Manual'), true);

      const templated = await getText(`${app.base}/v0/template/note/Ada`);
      assert.equal(templated.status, 200);
      assert.equal(templated.body.includes('Template note for Ada.'), true);
    } finally {
      if (app) await app.fastify.close();
      await closeSession(session);
    }
  });
}

describe('rest http integration', httpSuite);

/**
 * Close a connect session and terminate the underlying stdio process.
 *
 * test runner alive if not explicitly terminated.
 *
 * @param {import('@mcp-layer/session').Session} session - MCP session to close.
 * @returns {Promise<void>}
 */
async function closeSession(session) {
  if (!session) return;

  const transport = session.transport;
  const child = transport && transport._process ? transport._process : null;

  await session.close();

  if (!child) return;

  await terminateChild(child);
}

/**
 * Wait for a child process to exit with a timeout.
 *
 * exit promptly.
 *
 * @param {import('node:child_process').ChildProcess} child - Spawned process.
 * @param {number} timeoutMs - Timeout to wait before giving up.
 * @returns {Promise<void>}
 */
function waitForExit(child, timeoutMs) {
  return new Promise(function wait(resolve) {
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      resolve();
    }

    child.once('exit', finish);
    child.once('close', finish);

    const timer = setTimeout(function onTimeout() {
      finish();
    }, timeoutMs);

    timer.unref();
  });
}

/**
 * Terminate a child process with a graceful timeout.
 *
 * only abort the client side.
 *
 * @param {import('node:child_process').ChildProcess} child - Spawned process.
 * @returns {Promise<void>}
 */
async function terminateChild(child) {
  if (child.exitCode !== null || child.killed) return;

  child.kill('SIGTERM');
  await waitForExit(child, 1000);

  if (child.exitCode !== null || child.killed) return;

  child.kill('SIGKILL');
  await waitForExit(child, 500);
}
