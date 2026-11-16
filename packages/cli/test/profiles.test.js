import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Storage } from 'cli-storage';
import { capture as recorder, derive } from '@mcp-layer/profiles';
import { capture } from '../src/capture.js';

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
    describe('profiles commands',
      /**
       * Register profiles commands integration coverage.
       * @returns {void} Completion of the real test operation.
       */
      function commands() {
        it('lists the evidence-only bundled catalog without loading MCP config',
          /**
           * Verify lists the evidence-only bundled catalog without loading MCP config.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function listing() {
            const result = await run(['profiles', 'list', '--format', 'json']);
            const profiles = JSON.parse(result.stdout);
            assert.ok(profiles.some(
              /**
               * Find the independently verified native client in the catalog.
               * @param {import('@mcp-layer/profiles').Profile} profile Bundled capture-derived profile.
               * @returns {boolean} Whether this is the observed Claude Code release.
               */
              function verified(profile) {
                return profile.client.name === 'claude-code' && profile.client.version === '2.1.325' &&
                  profile.http.headers['user-agent'] === 'claude-code/2.1.325 (sdk-cli)';
              }));
          });
        it('builds deterministic artifacts and shows profile evidence offline',
          /**
           * Verify builds deterministic artifacts and shows profile evidence offline.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function building(t) {
            const state = await setup(t);
            const output = path.join(state.directory, 'built.json');
            await run(['profiles', 'build', state.capture, '--output', output]);
            const first = await readFile(output, 'utf8');
            await run(['profiles', 'build', state.capture, '--output', output]);
            assert.equal(await readFile(output, 'utf8'), first);
            const shown = await run(['profiles', 'show', output, '--format', 'json', '--oauth']);
            assert.equal(JSON.parse(shown.stdout).client.name, 'captured-desktop');
          });
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
