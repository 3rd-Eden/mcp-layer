import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { authorize } from '@mcp-layer/forward';
import { Storage } from 'cli-storage';
import { derive, capture, load } from '../src/index.js';
import { listen as captureServer } from '../src/listen.js';
import { run as runApi } from '../src/cli.js';
import { host } from './fixtures/process.mjs';
import { browser } from './fixtures/browser.mjs';

const exec = promisify(execFile);
const bin = fileURLToPath(new URL('../bin/profiles.js', import.meta.url));
const oauthbin = fileURLToPath(new URL('./fixtures/oauth-cli.mjs', import.meta.url));

/** @param {string[]} args CLI arguments. @returns {Promise<{stdout:string,stderr:string}>} Real process result. */
async function run(args) { return exec(process.execPath, [bin, ...args], { timeout: 10000 }); }

describe('@mcp-layer/profiles CLI',
  /** @returns {void} Registers real standalone command coverage. */
  function suite() {
    it('lists the bundled catalog without loading MCP configuration',
      /** @returns {Promise<void>} Completion after reading the standalone output. */
      async function listing() {
        const result = await run(['list', '--format', 'json']);
        assert.ok(JSON.parse(result.stdout).some(
          /** @param {import('../src/types.js').Profile} profile Listed bundled profile. @returns {boolean} Whether the native catalog entry is present. */
          function verified(profile) { return profile.client.name === 'claude-code'; }));
      });
    it('reconstructs an in-memory profile without untrusted root fields',
      /** @returns {Promise<void>} Completion after public loader validation. */
      async function loading() {
        const recorder = capture({ client: { name: 'load-demo', version: '1.0.0' } });
        recorder.observe({ phase: 'mcp', perspective: 'downstream', message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'load-demo', version: '1.0.0' } } }, provenance: { role: 'client' } });
        const profile = derive(recorder.finish());
        const loaded = await load({ ...profile, untrusted: 'discard this field' });
        assert.equal(loaded.untrusted, undefined);
        assert.deepEqual(loaded, profile);
      });
    it('refuses captured confidential OAuth bindings in the standalone runner',
      /** @param {import('node:test').TestContext} t Test cleanup lifecycle. @returns {Promise<void>} Completion after rejecting unsafe implicit credentials. */
      async function confidentialProfile(t) {
        const directory = await mkdtemp(path.join(tmpdir(), 'mcp-profiles-confidential-'));
        t.after(
          /** @returns {Promise<void>} Remove the isolated profile fixture directory. */
          async function cleanup() { await rm(directory, { recursive: true, force: true }); });
        const recorder = capture({ client: { name: 'private-client', version: '1.0.0' } });
        recorder.observe({ phase: 'mcp', perspective: 'downstream', message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'private-client', version: '1.0.0' } } }, provenance: { role: 'client' } });
        recorder.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: 'public-capture-id', client_name: 'private-client', token_endpoint_auth_method: 'client_secret_basic' }, provenance: { role: 'client', issuer: 'https://issuer.example' } });
        const profilePath = path.join(directory, 'profile.json');
        await writeFile(profilePath, JSON.stringify(derive(recorder.finish())));
        await assert.rejects(runApi(['capture', '--output', path.join(directory, 'capture.json'), '--upstream', 'https://mcp.example/mcp', '--oauth', '--profile', profilePath, '--issuer', 'https://issuer.example', '--client-id', 'public-capture-id']), { code: 'ERR_PROFILES_OAUTH_CREDENTIALS', package: '@mcp-layer/profiles', method: 'run', docs: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/profiles/README.md#error-101e96' });
      });
    it('reuses a captured public registration when the issuer differs only by its root slash',
      /**
       * Verify a real SDK OAuth flow reuses the captured preregistration constraints.
       * @param {import('node:test').TestContext} t Test cleanup lifecycle.
       * @returns {Promise<void>} Completion after OAuth and MCP requests through the standalone CLI.
       */
      async function equivalentIssuer(t) {
        const directory = await mkdtemp(path.join(tmpdir(), 'mcp-profiles-issuer-match-'));
        t.after(
          /** @returns {Promise<void>} Remove isolated issuer, gateway and client storage. */
          async function cleanup() { await rm(directory, { recursive: true, force: true }); });
        const registration = {
          client_id: 'profiles-public-test-client',
          client_name: 'Profiles public test client',
          redirect_uris: ['http://127.0.0.1:0/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        };
        const upstream = await captureServer({
          oauth: { clients: [registration] },
          storage: new Storage({ namespace: 'issuer', directory, backend: 'file' }),
        });
        t.after(upstream.close);
        const issuer = new URL('/', upstream.url).href;
        const recorder = capture({ client: { name: 'issuer-match-client', version: '1.0.0' } });
        recorder.observe({ phase: 'mcp', perspective: 'downstream', message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'issuer-match-client', version: '1.0.0' } } }, provenance: { role: 'client' } });
        recorder.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: registration.client_id, client_name: registration.client_name, redirect_uris: registration.redirect_uris, token_endpoint_auth_method: registration.token_endpoint_auth_method }, provenance: { role: 'client', issuer } });
        recorder.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: 'profiles-path-bound-client', client_name: registration.client_name, redirect_uris: registration.redirect_uris, token_endpoint_auth_method: 'none' }, provenance: { role: 'client', issuer: `${issuer}tenant/` } });
        const profilePath = path.join(directory, 'profile.json');
        await writeFile(profilePath, JSON.stringify(derive(recorder.finish())));
        const output = path.join(directory, 'capture.json');
        const runtime = await host(t, [
          'capture', '--upstream', upstream.url, '--oauth', '--issuer', issuer.slice(0, -1),
          '--profile', profilePath, '--output', output,
          '--storage-dir', path.join(directory, 'gateway'), '--storage-backend', 'file',
        ], oauthbin);
        const provider = authorize({ target: runtime.url, storage: new Storage({ namespace: 'downstream', directory, backend: 'file' }), open: browser });
        t.after(
          /** @returns {Promise<void>} Close the downstream OAuth callback listener. */
          async function closeProvider() { await provider.close(); });
        await provider.access();
        const client = new Client({ name: 'issuer-match-sdk-client', version: '1.0.0' });
        t.after(
          /** @returns {Promise<void>} Close the real MCP SDK client. */
          async function closeClient() { await client.close(); });
        await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url), { fetch: provider.fetch, authProvider: provider }));
        assert.equal((await client.listTools()).tools[0].name, 'probe');
        await client.close();
        await runtime.close();
        const registrationRequest = upstream.finish().observations.find(
          /** @param {import('../src/types.js').Evidence} evidence Sanitized issuer observation. @returns {boolean} Whether it is an upstream dynamic registration request. */
          function dynamicRegistration(evidence) { return evidence.phase === 'registration' && evidence.method === 'POST'; });
        assert.equal(registrationRequest, undefined);
      });
    it('builds deterministic profiles and shows a validated JSON artifact',
      /** @param {import('node:test').TestContext} t Test cleanup lifecycle. @returns {Promise<void>} Completion after real file operations. */
      async function building(t) {
        const directory = await mkdtemp(path.join(tmpdir(), 'mcp-profiles-cli-'));
        t.after(
          /** @returns {Promise<void>} Remove the isolated artifact directory. */
          async function cleanup() { await rm(directory, { recursive: true, force: true }); });
        const recorder = capture({ client: { name: 'cli-demo', version: '1.0.0' } });
        recorder.observe({ phase: 'mcp', perspective: 'downstream', message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'cli-demo', version: '1.0.0' } } }, provenance: { role: 'client' } });
        const capturePath = path.join(directory, 'capture.json');
        const profilePath = path.join(directory, 'profile.json');
        await writeFile(capturePath, JSON.stringify(recorder.finish()));
        await runApi(['build', capturePath, '--output', profilePath]);
        const first = await readFile(profilePath, 'utf8');
        await runApi(['build', capturePath, '--output', profilePath]);
        assert.equal(await readFile(profilePath, 'utf8'), first);
        const shown = await run(['show', profilePath, '--format', 'json']);
        assert.equal(JSON.parse(shown.stdout).client.name, 'cli-demo');
      });
  });
