import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { authorize } from '@mcp-layer/forward';
import { capture as record, derive, listen as capture } from '../src/index.js';
import { Storage } from 'cli-storage';
import { host } from './fixtures/process.mjs';
import { browser } from './fixtures/browser.mjs';

const bin = fileURLToPath(new URL('../bin/profiles.js', import.meta.url));
const oauthbin = fileURLToPath(new URL('./fixtures/oauth-cli.mjs', import.meta.url));

describe('@mcp-layer/profiles', /** Register profiles integration suites. @returns {void} */
function suite() {
  describe('forwarded capture', /** Register real forwarding capture scenarios. @returns {void} */
  function forwarded() {
        it('runs forwarded capture through separate downstream and upstream consent',
          /**
           * Exercise the real CLI broker, both SDK issuers and capture export.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion after both grants, MCP traffic and artifact export.
           */
          async function broker(t) {
            const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cli-broker-'));
            t.after(
              /** @returns {Promise<void>} Remove isolated broker and issuer records. */
              async function cleanup() { await rm(directory, { recursive: true, force: true }); });
            const upstream = await capture({ oauth: true, storage: new Storage({ namespace: 'upstream', directory, backend: 'file' }) });
            t.after(upstream.close);
            const output = path.join(directory, 'capture.json');
            const runtime = await host(t, ['capture', '--upstream', upstream.url, '--oauth', '--output', output, '--storage-dir', path.join(directory, 'gateway'), '--storage-backend', 'file'], oauthbin);
            const provider = authorize({ target: runtime.url, storage: new Storage({ namespace: 'downstream', directory, backend: 'file' }), open: browser });
            t.after(
              /** @returns {Promise<void>} Close the downstream provider's callback listener. */
              async function cleanup() { await provider.close(); });
            await provider.access();
            const client = new Client({ name: 'original-oauth-client', version: '8.0.0' });
            await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url), { fetch: provider.fetch, authProvider: provider }));
            assert.equal((await client.listTools()).tools[0].name, 'probe');
            await client.close();
            await runtime.close();
            const artifact = JSON.parse(await readFile(output, 'utf8'));
            assert.equal(derive(artifact).client.name, 'original-oauth-client');
            assert.equal(artifact.observations.some(
              /** @param {import('@mcp-layer/profiles').Evidence} value Boundary evidence. @returns {boolean} Whether upstream OAuth was observed. */
              function upstream(value) { return value.perspective === 'upstream' && value.phase === 'token'; }), true);
            assert.equal(artifact.observations.some(
              /** @param {import('@mcp-layer/profiles').Evidence} value Boundary evidence. @returns {boolean} Whether downstream OAuth was observed. */
              function downstream(value) { return value.perspective === 'downstream' && value.phase === 'token'; }), true);
          });
        it('applies only selected profile parts during upstream OAuth and MCP forwarding',
          /**
           * Exercise selected profile parts through real SDK OAuth registration and MCP traffic.
           * @param {import('node:test').TestContext} t Test cleanup lifecycle.
           * @returns {Promise<void>} Completion after forwarding, OAuth, and capture export.
           */
          async function parts(t) {
            const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cli-profile-parts-'));
            t.after(
              /** @returns {Promise<void>} Remove isolated OAuth records and artifacts. */
              async function cleanup() { await rm(directory, { recursive: true, force: true }); });
            const upstream = await capture({ oauth: true, storage: new Storage({ namespace: 'profile-parts-issuer', directory, backend: 'file' }) });
            t.after(upstream.close);
            const issuer = new URL('/', upstream.url).href;
            const recorder = record({ client: { name: 'profile-parts-client', version: '3.0.0' } });
            recorder.observe({ phase: 'mcp', perspective: 'downstream', headers: { 'user-agent': 'profile-parts-client/3.0.0' }, message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'profile-parts-client', version: '3.0.0' } } }, provenance: { role: 'client' } });
            recorder.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: 'captured-profile-id', client_name: 'captured-profile-oauth-name', token_endpoint_auth_method: 'client_secret_basic' }, provenance: { role: 'client', issuer } });
            const profilePath = path.join(directory, 'profile.json');
            await writeFile(profilePath, JSON.stringify(derive(recorder.finish())));
            const output = path.join(directory, 'capture.json');
            const runtime = await host(t, ['capture', '--upstream', upstream.url, '--oauth', '--issuer', issuer, '--profile', profilePath, '--profile-parts', 'http,mcp', '--output', output, '--storage-dir', path.join(directory, 'gateway'), '--storage-backend', 'file'], oauthbin);
            const provider = authorize({ target: runtime.url, storage: new Storage({ namespace: 'profile-parts-downstream', directory, backend: 'file' }), open: browser });
            t.after(
              /** @returns {Promise<void>} Close the downstream OAuth callback listener. */
              async function cleanup() { await provider.close(); });
            await provider.access();
            const client = new Client({ name: 'original-parts-client', version: '1.0.0' });
            await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url), { fetch: provider.fetch, authProvider: provider }));
            assert.equal((await client.listTools()).tools[0].name, 'probe');
            await client.close();
            await runtime.close();
            const artifact = JSON.parse(await readFile(output, 'utf8'));
            const registration = artifact.observations.find(
              /** @param {import('@mcp-layer/profiles').Evidence} value Observed OAuth event. @returns {boolean} Whether this is upstream client registration. */
              function upstreamRegistration(value) { return value.phase === 'registration' && value.perspective === 'upstream' && value.method === 'POST'; });
            assert.ok(registration);
            assert.notEqual(registration.body.client_name, 'captured-profile-oauth-name');
            assert.notEqual(registration.body.client_id, 'captured-profile-id');
            const initializing = artifact.observations.find(
              /** @param {import('@mcp-layer/profiles').Evidence} value Observed MCP event. @returns {boolean} Whether this is the upstream initialize exchange. */
              function upstreamInitialize(value) { return value.phase === 'mcp' && value.perspective === 'upstream' && value.message?.method === 'initialize'; });
            assert.equal(initializing.message.params.clientInfo.name, 'profile-parts-client');
          });
        it('captures original and bridged identity separately and exports on SIGTERM',
          /**
           * Verify captures original and bridged identity separately and exports on SIGTERM.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function observing(t) {
            const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cli-forward-'));
            t.after(
              /**
               * Release real test resources.
               * @returns {Promise<void>} Completion of the real test operation.
               */
              async function cleanup() { await rm(directory, { recursive: true, force: true }); });
            const upstream = await capture();
            t.after(upstream.close);
            const output = path.join(directory, 'capture.json');
            const runtime = await host(t, ['capture', '--upstream', upstream.url, '--output', output]);
            const client = new Client({ name: 'original-client', version: '7.0.0' });
            await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url), { requestInit: { headers: { 'user-agent': 'original-client/7.0.0', authorization: 'Bearer private-forwarding-secret' } } }));
            await client.listTools();
            await client.close();
            await runtime.close();
            const artifact = JSON.parse(await readFile(output, 'utf8'));
            const initialize = artifact.observations.filter(
              /**
               * Select initializing evidence.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {boolean} Whether the boundary observation matches.
               */
              function initializing(value) { return value.message?.method === 'initialize'; });
            assert.equal(initialize.length, 2);
            assert.deepEqual(initialize.map(
              /**
               * Read role from observed client behavior.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {string} Observed public identity value.
               */
              function role(value) { return value.provenance.role; }), ['client', 'bridge']);
            assert.equal(initialize[0].message.params.clientInfo.name, 'original-client');
            assert.equal(JSON.stringify(artifact).includes('private-forwarding-secret'), false);
          });
  });
});
