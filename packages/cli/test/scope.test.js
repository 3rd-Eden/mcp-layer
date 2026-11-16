import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const exec = promisify(execFile);

/**
 * Register assertions for the main CLI's public scope and passive command handling.
 * @returns {void} Completion of test registration.
 */
function scope() {
  it('omits profile tooling from public help', help);
  it('prints forward help without selecting a server or probing a target', forwardHelp);
  it('redacts target credentials from unauthenticated status without creating storage', safeStatus);
  it('does not export the removed capture subpath', captureExport);
}

/**
 * Confirm the executable help documents runtime profile selection without profile tooling commands.
 * @returns {void} Help output excludes profile list, show, build, and capture commands.
 */
function help() {
  const result = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--profile <id\|file>/);
  assert.doesNotMatch(result.stdout, /profiles list\|show\|build\|capture/);
}

/**
 * Confirm forward help is static for both configured selection and explicit URL forms.
 * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
 * @returns {Promise<void>} Both help forms succeed without network requests.
 */
async function forwardHelp(t) {
  const state = await config(t);
  let requests = 0;
  const server = createServer(
    /** @param {import('node:http').IncomingMessage} request Tripwire request. @param {import('node:http').ServerResponse} response Tripwire response. @returns {void} Record and answer any unexpected network access. */
    function tripwire(request, response) { requests += 1; response.end('unexpected'); });
  const address = await new Promise(
    /** @param {(value: import('node:net').AddressInfo) => void} resolve Resolve with the bound address. @param {(reason: Error) => void} reject Reject on bind failure. @returns {void} Start the local tripwire listener. */
    function listening(resolve, reject) {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', /** @returns {void} Resolve with the bound tripwire address. */
      function bound() {
        server.off('error', reject);
        resolve(server.address());
      });
    });
  t.after(
    /** @returns {Promise<void>} Close the local tripwire server. */
    async function closeServer() {
      server.closeAllConnections();
      await new Promise(
        /** @param {() => void} resolve Resolve when shutdown completes. @returns {void} Start listener shutdown. */
        function closing(resolve) { server.close(resolve); });
    });
  const env = { ...process.env, MCP_CONFIG_PATH: state.file, NO_COLOR: '1' };
  const target = `http://127.0.0.1:${address.port}/mcp`;
  const withoutTarget = await exec(process.execPath, [bin, 'forward', '--help', '--config', state.file], { env, timeout: 3000 });
  const withTarget = await exec(process.execPath, [bin, 'forward', target, '--help', '--config', state.file], { env, timeout: 3000 });
  for (const output of [withoutTarget.stdout, withTarget.stdout]) {
    assert.match(output, /forward \[url\]/);
    assert.match(output, /--profile-parts/);
    assert.match(output, /--callback-url/);
  }
  assert.equal(requests, 0);
}

/**
 * Confirm unauthenticated status reports only the origin without initializing storage.
 * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
 * @returns {Promise<void>} JSON status contains only the safe origin and path.
 */
async function safeStatus(t) {
  const state = await config(t);
  const storage = path.join(state.directory, 'storage');
  const target = 'https://user:pass@example.com/tokens/path-sentinel?api_key=status-sentinel#fragment';
  const result = await exec(process.execPath, [bin, 'forward', target, '--no-oauth', '--status', '--format', 'json', '--storage-dir', storage, '--storage-backend', 'file'], {
    env: { ...process.env, MCP_CONFIG_PATH: state.file, NO_COLOR: '1' },
    timeout: 3000,
  });
  const status = JSON.parse(result.stdout);
  assert.equal(status.target, 'https://example.com');
  assert.equal(JSON.stringify(status).includes('status-sentinel'), false);
  assert.equal(JSON.stringify(status).includes('path-sentinel'), false);
  await assert.rejects(readdir(storage), { code: 'ENOENT' });
}

/**
 * Create an isolated empty MCP configuration for CLI subprocesses.
 * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
 * @returns {Promise<{directory:string,file:string}>} Temporary config path and its directory.
 */
async function config(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cli-scope-'));
  t.after(
    /** @returns {Promise<void>} Remove the isolated configuration directory. */
    async function cleanup() { await rm(directory, { recursive: true, force: true }); });
  const file = path.join(directory, 'mcp.json');
  await writeFile(file, JSON.stringify({ mcpServers: {} }));
  return { directory, file };
}

/**
 * Confirm package exports reject the unshipped capture API.
 * @returns {Promise<void>} Import rejects with Node's package export error.
 */
async function captureExport() {
  await assert.rejects(import('@mcp-layer/cli/capture'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' });
}

describe('@mcp-layer/cli', scope);
