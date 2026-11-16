import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { Storage } from 'cli-storage';
import { capture as recorder, derive } from '@mcp-layer/profiles';
import { listen as capture } from '@mcp-layer/profiles';

const exec = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const oauthbin = fileURLToPath(new URL('./fixtures/oauth-cli.mjs', import.meta.url));
const slowbin = fileURLToPath(new URL('./fixtures/slow-oauth-cli.mjs', import.meta.url));

/**
 * Create isolated artifacts and optional OAuth issuer storage for a test.
 * @param {import('node:test').TestContext} t Test lifecycle.
 * @returns {Promise<{directory:string,profile:string,capture:string,storage:Storage}>} Local artifact paths.
 */
async function setup(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cli-profile-'));
  t.after(
    /**
     * Release real test resources.
     * @returns {Promise<void>} Completion of the real test operation.
     */
    async function cleanup() { await rm(directory, { recursive: true, force: true }); });
  const record = recorder({ client: { name: 'captured-desktop', version: '5.0.0' } });
  record.observe({ phase: 'mcp', perspective: 'downstream', headers: { 'user-agent': 'captured-desktop/5.0.0' }, message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'captured-desktop', version: '5.0.0' } } }, provenance: { role: 'client' } });
  const artifact = record.finish();
  const profile = path.join(directory, 'profile.json');
  const file = path.join(directory, 'capture.json');
  await writeFile(profile, JSON.stringify(derive(artifact)));
  await writeFile(file, JSON.stringify(artifact));
  return { directory, profile, capture: file, storage: new Storage({ namespace: 'test-issuer', directory, backend: 'file' }) };
}

/**
 * Invoke the real CLI as a subprocess with a bounded runtime.
 * @param {string[]} args CLI arguments.
 * @param {string} [entry=bin] CLI builder fixture or published bin.
 * @returns {Promise<{stdout:string,stderr:string}>} Process output.
 */
async function run(args, entry = bin) { return exec(process.execPath, [entry, ...args], { env: { ...process.env, NO_COLOR: '1' }, timeout: 10000 }); }

/**
 * Create a config pointing at one real capture endpoint.
 * @param {string} directory Temporary artifact root.
 * @param {string} url Real MCP endpoint.
 * @returns {Promise<string>} Config path.
 */
async function config(directory, url) {
  const file = path.join(directory, 'mcp.json');
  await writeFile(file, JSON.stringify({ mcpServers: { demo: { url } } }));
  return file;
}

/**
 * Add actually observed public registration metadata to a profile artifact.
 * @param {{capture:string,profile:string}} state Initial capture and profile paths.
 * @param {string} issuer Authorization server origin.
 * @param {object} metadata Metadata sent in a real registration or explicitly declared request boundary.
 * @param {object} [client] Actual registration response from the local issuer.
 * @returns {Promise<void>} Evidence-backed profile artifact containing the public OAuth identity.
 */
async function registration(state, issuer, metadata, client) {
  const initial = JSON.parse(await readFile(state.capture, 'utf8'));
  const record = recorder({ client: initial.client, capturedAt: initial.capturedAt });
  for (const observation of initial.observations) record.observe(observation);
  record.observe({ phase: 'registration', perspective: 'downstream', body: metadata, provenance: { role: 'client', issuer } });
  if (client) record.observe({ phase: 'registration', perspective: 'downstream', body: client, status: 201, provenance: { role: 'client', issuer } });
  await writeFile(state.profile, JSON.stringify(derive(record.finish())));
}

describe('cli',
  /**
   * Register cli integration coverage.
   * @returns {void} Completion of the real test operation.
   */
  function suite() {
    describe('profile runtime',
      /**
       * Register profile runtime integration coverage.
       * @returns {void} Completion of the real test operation.
       */
      function runtime() {
        it('applies one profile across catalog and both help connection paths',
          /**
           * Verify applies one profile across catalog and both help connection paths.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function paths(t) {
            const state = await setup(t);
            const runtime = await capture();
            t.after(runtime.close);
            const file = await config(state.directory, runtime.url);
            for (const command of [['tools', 'list'], ['tools', 'probe', '--help'], ['--help']]) {
              const parts = command[1] === 'list' ? [] : ['--profile-parts', 'http,mcp'];
              await run([...command, '--config', file, '--profile', state.profile, ...parts]);
            }
            const messages = runtime.finish().observations.filter(
              /**
               * Select initialize evidence.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {boolean} Whether the boundary observation matches.
               */
              function initialize(value) { return value.message?.method === 'initialize'; });
            assert.equal(messages.length, 3);
            for (const message of messages) {
              assert.equal(message.message.params.clientInfo.name, 'captured-desktop');
              assert.equal(message.headers['user-agent'], 'captured-desktop/5.0.0');
            }
          });
        it('uses a full OAuth identity profile with an unauthenticated MCP endpoint',
          /**
           * Verify public registration defaults do not force an open resource to authorize.
           * @param {import('node:test').TestContext} t Test resource cleanup lifecycle.
           * @returns {Promise<void>} The real CLI lists tools without starting OAuth.
           */
          async function optional(t) {
            const state = await setup(t);
            const runtime = await capture();
            t.after(runtime.close);
            await registration(state, new URL('/', runtime.url).href, { client_name: 'Captured OAuth identity' });
            const file = await config(state.directory, runtime.url);
            const result = await run(['tools', 'list', '--config', file, '--profile', state.profile,
              '--storage-dir', path.join(state.directory, 'credentials'), '--storage-backend', 'file', '--format', 'json']);
            assert.equal(JSON.parse(result.stdout)[0].name, 'probe');
            assert.equal(runtime.finish().observations.some(
              /**
               * Detect an unintended OAuth registration or token exchange.
               * @param {import('@mcp-layer/profiles').Evidence} event Sanitized endpoint observation.
               * @returns {boolean} Whether authentication was unnecessarily initiated.
               */
              function authorized(event) { return ['registration', 'authorization', 'token'].includes(event.phase); }), false);
          });
        it('completes OAuth with persistent cli-storage through the public builder',
          /**
           * Verify completes OAuth with persistent cli-storage through the public builder.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function oauth(t) {
            const state = await setup(t);
            const runtime = await capture({ oauth: true, storage: state.storage });
            t.after(runtime.close);
            const file = await config(state.directory, runtime.url);
            const args = ['tools', 'list', '--config', file, '--oauth', '--profile', state.profile, '--storage-dir', path.join(state.directory, 'credentials'), '--storage-backend', 'file', '--format', 'json'];
            const result = await run(args, oauthbin);
            assert.equal(JSON.parse(result.stdout)[0].name, 'probe');
            await run(args, oauthbin);
            const artifact = runtime.finish();
            assert.equal(artifact.observations.filter(
              /**
               * Select registration evidence.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {boolean} Whether the boundary observation matches.
               */
              function registration(value) { return value.phase === 'registration' && value.method === 'POST'; }).length, 1);
            assert.equal(artifact.observations.some(
              /**
               * Complete the real test lifecycle.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {void} Completion of the real test operation.
               */
              function token(value) { return value.body?.code_verifier === '[redacted]'; }), true);
          });
        it('allows browser consent to outlive the connection handshake deadline',
          /**
           * Verify allows browser consent to outlive the connection handshake deadline.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function deadlines(t) {
            const state = await setup(t);
            const runtime = await capture({ oauth: true, storage: state.storage });
            t.after(runtime.close);
            const file = await config(state.directory, runtime.url);
            const result = await run(['tools', 'list', '--config', file, '--oauth', '--timeout', '150', '--auth-timeout', '5000', '--storage-dir', path.join(state.directory, 'credentials'), '--storage-backend', 'file', '--format', 'json'], slowbin);
            assert.equal(JSON.parse(result.stdout)[0].name, 'probe');
          });
        it('authorizes legacy SSE connections through the controlled issuer',
          /**
           * Verify authorizes legacy SSE connections through the controlled issuer.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function oauthsse(t) {
            const state = await setup(t);
            const runtime = await capture({ transport: 'sse', oauth: true, storage: state.storage });
            t.after(runtime.close);
            const file = await config(state.directory, runtime.url);
            const result = await run(['tools', 'list', '--config', file, '--transport', 'sse', '--oauth', '--storage-dir', path.join(state.directory, 'credentials'), '--storage-backend', 'file', '--format', 'json'], oauthbin);
            assert.equal(JSON.parse(result.stdout)[0].name, 'probe');
          });
        it('rejects captured confidential OAuth registrations before consent',
          /**
           * Verify confidential public identity metadata is not selected without its secret.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} The CLI returns an actionable error without opening consent.
           */
          async function confidential(t) {
            const state = await setup(t);
            const runtime = await capture({ oauth: true, storage: state.storage });
            t.after(runtime.close);
            const issuer = new URL('/', runtime.url).href;
            await registration(state, issuer, { client_name: 'Captured confidential client', token_endpoint_auth_method: 'client_secret_basic' }, {
              client_id: 'captured-confidential-client',
              client_secret: 'captured-secret-must-not-be-reused',
              token_endpoint_auth_method: 'client_secret_basic',
            });
            const file = await config(state.directory, runtime.url);
            await assert.rejects(run(['tools', 'list', '--config', file, '--profile', state.profile, '--storage-dir', path.join(state.directory, 'credentials'), '--storage-backend', 'file']),
              /** @param {Error & {stderr?:string}} error CLI subprocess failure. @returns {boolean} Whether refusal explains missing caller-owned credentials. */
              function actionable(error) { return error.stderr?.includes('Captured OAuth client requires caller-owned credentials') ?? false; });
            const artifact = runtime.finish();
            assert.equal((await readFile(state.profile, 'utf8')).includes('captured-secret-must-not-be-reused'), false);
            assert.equal(JSON.stringify(artifact).includes('captured-secret-must-not-be-reused'), false);
            assert.equal(artifact.observations.some(
              /** @param {import('@mcp-layer/profiles').Evidence} value Captured issuer evidence. @returns {boolean} Whether the CLI reached user consent. */
              function consent(value) { return value.phase === 'authorization'; }), false);
          });
        it('uses profile OAuth metadata before constructing the authorization provider',
          /**
           * Verify uses profile OAuth metadata before constructing the authorization provider.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function metadata(t) {
            const state = await setup(t);
            const runtime = await capture({ oauth: true, storage: state.storage });
            t.after(runtime.close);
            const file = await config(state.directory, runtime.url);
            await registration(state, new URL('/', runtime.url).href, { client_name: 'Captured Desktop', software_id: 'captured-desktop', software_version: '5.0.0', token_endpoint_auth_method: 'none' });
            await run(['tools', 'list', '--config', file, '--profile', state.profile, '--storage-dir', path.join(state.directory, 'credentials'), '--storage-backend', 'file'], oauthbin);
            const request = runtime.finish().observations.find(
              /**
               * Select registering evidence.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {boolean} Whether the boundary observation matches.
               */
              function registering(value) { return value.phase === 'registration' && value.method === 'POST'; });
            assert.equal(request.body.client_name, 'Captured Desktop');
            assert.equal(request.body.software_version, '5.0.0');
          });
        it('binds public client IDs to the discovered issuer and lets runtime registration win',
          /**
           * Verify binds public client IDs to the discovered issuer and lets runtime registration win.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function binding(t) {
            const state = await setup(t);
            const runtime = await capture({ oauth: true, storage: state.storage });
            t.after(runtime.close);
            const file = await config(state.directory, runtime.url);
            const issuer = new URL('/', runtime.url).href;
            const metadata = { client_name: 'Captured Desktop', redirect_uris: ['http://localhost/return'], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
            const first = await fetch(new URL('/register', runtime.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(metadata) });
            const observed = await first.json();
            const second = await fetch(new URL('/register', runtime.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(metadata) });
            const override = await second.json();
            await registration(state, issuer, metadata, observed);
            await run(['tools', 'list', '--config', file, '--profile', state.profile, '--callback-url', 'http://localhost:0/return', '--storage-dir', path.join(state.directory, 'captured'), '--storage-backend', 'file'], oauthbin);
            await run(['tools', 'list', '--config', file, '--profile', state.profile, '--client-id', override.client_id, '--issuer', issuer, '--scope', 'mcp', '--resource', runtime.url, '--callback-url', 'http://localhost:0/return', '--callback-port', '0', '--auth-timeout', '5000', '--storage-dir', path.join(state.directory, 'override'), '--storage-backend', 'file'], oauthbin);
            const artifact = runtime.finish();
            assert.equal(artifact.observations.filter(
              /**
               * Select registering evidence.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {boolean} Whether the boundary observation matches.
               */
              function registering(value) { return value.phase === 'registration' && value.method === 'POST'; }).length, 2);
            const requests = artifact.observations.filter(
              /**
               * Select authorizing evidence.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {boolean} Whether the boundary observation matches.
               */
              function authorizing(value) { return value.phase === 'authorization' && value.method === 'GET'; });
            assert.deepEqual(requests.map(
              /**
               * Read identifier from observed client behavior.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {string} Observed public identity value.
               */
              function identifier(value) { return new URL(value.url).searchParams.get('client_id'); }), [observed.client_id, override.client_id]);
          });
        it('bounds the implicit OAuth resource probe by the authorization deadline',
          /**
           * Verify a resource that accepts but never completes the implicit auth probe is bounded.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} The CLI exits with an actionable timeout instead of hanging.
           */
          async function probeDeadline(t) {
            const state = await setup(t);
            await registration(state, 'https://issuer.example/', { client_name: 'Observed OAuth client' });
            const server = createServer(
              /** @param {import('node:http').IncomingMessage} request Hanging probe request. @param {import('node:http').ServerResponse} response Unfinished response. @returns {void} Keep the real socket open until the CLI deadline aborts it. */
              function stalled(request, response) { void request; void response; });
            await new Promise(
              /** @param {(value: import('node:net').AddressInfo) => void} resolve Resolve with the bound endpoint. @param {(reason: Error) => void} reject Reject if the server cannot bind. @returns {void} Starts the local HTTP server. */
              function listening(resolve, reject) {
                server.once('error', reject);
                server.listen(0, '127.0.0.1', /** @returns {void} Resolve with the available local probe address. */
                function bound() {
                  server.off('error', reject);
                  resolve(server.address());
                });
              });
            t.after(
              /** @returns {Promise<void>} Close the local probe server and open sockets. */
              async function closeServer() {
                server.closeAllConnections();
                await new Promise(
                  /** @param {() => void} resolve Resolve after server shutdown. @returns {void} Starts shutdown. */
                  function closing(resolve) { server.close(resolve); });
              });
            const address = server.address();
            const endpoint = `http://127.0.0.1:${address.port}/mcp`;
            const file = await config(state.directory, endpoint);
            await assert.rejects(exec(process.execPath, [bin, 'tools', 'list', '--config', file, '--profile', state.profile, '--auth-timeout', '100', '--storage-dir', path.join(state.directory, 'credentials'), '--storage-backend', 'file'], {
              env: { ...process.env, NO_COLOR: '1' },
              timeout: 2000,
            }),
            /** @param {Error & {stderr?:string}} error CLI subprocess failure. @returns {boolean} Whether timeout message gives the relevant flag. */
            function actionable(error) { return error.stderr?.includes('--auth-timeout') ?? false; });
          });
        it('keeps general help and status from starting login or initializing storage',
          /**
           * Verify keeps general help and status from starting login or initializing storage.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function inspection(t) {
            const state = await setup(t);
            const runtime = await capture({ oauth: true, storage: state.storage });
            t.after(runtime.close);
            const file = await config(state.directory, runtime.url);
            const directory = path.join(state.directory, 'inspection');
            await run(['--help', '--config', file, '--oauth', '--profile', state.profile, '--storage-dir', directory], oauthbin);
            const status = await run(['forward', runtime.url, '--status', '--storage-dir', directory, '--format', 'json'], oauthbin);
            assert.equal(JSON.parse(status.stdout).registered, false);
            assert.equal(runtime.finish().observations.some(
              /**
               * Complete the real test lifecycle.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {void} Completion of the real test operation.
               */
              function registration(value) { return value.phase === 'registration'; }), false);
            await assert.rejects(readdir(directory), { code: 'ENOENT' });
          });
      });
  });
