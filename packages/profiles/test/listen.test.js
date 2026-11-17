import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { derive } from '../src/index.js';
import { authorize } from '@mcp-layer/forward';
import { connect } from '../../connect/src/index.js';
import { Storage } from 'cli-storage';
import { listen as capture } from '../src/listen.js';
import { browser } from './fixtures/browser.mjs';

const bin = fileURLToPath(new URL('../bin/profiles.js', import.meta.url));

describe('@mcp-layer/profiles',
  /**
   * Register cli integration coverage.
   * @returns {void} Completion of the real test operation.
   */
  function suite() {
    describe('capture',
      /**
       * Register capture integration coverage.
       * @returns {void} Completion of the real test operation.
       */
      function capturing() {
        it('hosts separate real SDK sessions and exports only sanitized evidence',
          /**
           * Verify hosts separate real SDK sessions and exports only sanitized evidence.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function http(t) {
            const runtime = await capture();
            t.after(runtime.close);
            const clients = [];
            for (const name of ['first', 'second']) {
              const client = new Client({ name, version: '1.2.3' });
              clients.push(client);
              await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url), { requestInit: { headers: { 'user-agent': `${name}/1.2.3`, authorization: 'Bearer capture-secret', cookie: 'capture-cookie' } } }));
              const tools = await client.listTools();
              assert.equal(tools.tools[0].name, 'probe');
              const result = await client.callTool({ name: 'probe', arguments: {} });
              assert.equal(result.content[0].text, 'Capture probe completed.');
            }
            for (const client of clients) await client.close();
            const artifact = runtime.finish();
            const messages = artifact.observations.filter(
              /**
               * Select initialize evidence.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {boolean} Whether the boundary observation matches.
               */
              function initialize(value) { return value.message?.method === 'initialize'; });
            assert.deepEqual(messages.map(
              /**
               * Read name from observed client behavior.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {string} Observed public identity value.
               */
              function name(value) { return value.message.params.clientInfo.name; }), ['first', 'second']);
            assert.equal(JSON.stringify(artifact).includes('capture-secret'), false);
            assert.equal(JSON.stringify(artifact).includes('capture-cookie'), false);
            assert.equal(messages[0].headers['user-agent'], 'first/1.2.3');
            assert.throws(
              /**
               * Derive deliberately conflicting downstream identity evidence.
               * @returns {void} Completion of the real test operation.
               */
              function conflicting() { derive(artifact); }, { code: 'ERR_PROFILES_CONFLICT' });
            await runtime.close();
            await runtime.closed;
          });

        it('hosts the legacy SSE transport with original client headers',
          /**
           * Verify hosts the legacy SSE transport with original client headers.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function sse(t) {
            const runtime = await capture({ transport: 'sse' });
            t.after(runtime.close);
            const client = new Client({ name: 'sse-client', version: '1.0.0' });
            await client.connect(new SSEClientTransport(new URL(runtime.url), { requestInit: { headers: { 'user-agent': 'sse-client/1.0.0' } } }));
            await client.listTools();
            await client.close();
            const artifact = runtime.finish();
            assert.equal(artifact.observations.some(
              /**
               * Complete the real test lifecycle.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {void} Completion of the real test operation.
               */
              function initialize(value) { return value.message?.params?.clientInfo?.name === 'sse-client'; }), true);
          });

        it('keeps stdio stdout protocol-only and writes the capture on shutdown',
          /**
           * Verify keeps stdio stdout protocol-only and writes the capture on shutdown.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function stdio(t) {
            const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cli-capture-'));
            t.after(
              /**
               * Release real test resources.
               * @returns {Promise<void>} Completion of the real test operation.
               */
              async function cleanup() { await rm(directory, { recursive: true, force: true }); });
            const output = path.join(directory, 'capture.json');
            const transport = new StdioClientTransport({ command: process.execPath, args: [bin, 'capture', '--transport', 'stdio', '--output', output, '--client-name', 'stdio-declared', '--client-version', '4.1.0'], stderr: 'pipe' });
            const client = new Client({ name: 'stdio-client', version: '4.0.0' });
            await client.connect(transport);
            await client.listTools();
            await client.close();
            const artifact = JSON.parse(await readFile(output, 'utf8'));
            assert.deepEqual(artifact.client, { name: 'stdio-declared', version: '4.1.0' });
            assert.equal(artifact.observations.some(
              /**
               * Complete the real test lifecycle.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {void} Completion of the real test operation.
               */
              function initialize(value) { return value.message?.params?.clientInfo?.name === 'stdio-client'; }), true);
          });
        for (const transport of ['streamable-http', 'sse']) {
          it(`passes SDK OAuth providers through connect over ${transport}`,
            /**
             * Verify provider.
             * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
             * @returns {Promise<void>} Completion of the real test operation.
             */
            async function provider(t) {
              const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cli-provider-'));
              t.after(
                /**
                 * Release real test resources.
                 * @returns {Promise<void>} Completion of the real test operation.
                 */
                async function cleanup() { await rm(directory, { recursive: true, force: true }); });
              const storage = new Storage({ namespace: 'issuer', directory, backend: 'file' });
              const runtime = await capture({ oauth: true, storage });
              t.after(runtime.close);
              const authorization = authorize({ target: runtime.url, storage: new Storage({ namespace: 'client', directory, backend: 'file' }), open: browser });
              t.after(
                /**
                 * Release real test resources.
                 * @returns {Promise<void>} Completion of the real test operation.
                 */
                async function cleanup() { await authorization.close(); });
              await authorization.access();
              const url = transport === 'sse' ? new URL('/sse', runtime.url).href : runtime.url;
              const source = new Map([['demo', { name: 'demo', source: '/tmp/mcp.json', config: { url } }]]);
              const session = await connect(source, 'demo', { transport, authProvider: authorization });
              assert.equal((await session.client.listTools()).tools[0].name, 'probe');
              await session.close();
            });
        }
        it('captures refresh with configured issuer scopes and token lifetimes',
          /**
           * Exercise short-lived real issuer credentials through the public capture runner.
           * @param {import('node:test').TestContext} t Test cleanup lifecycle.
           * @returns {Promise<void>} Discovery, registration, exchange, and refresh are captured.
           */
          async function refreshing(t) {
            const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cli-refresh-'));
            t.after(
              /** @returns {Promise<void>} Remove isolated runtime credentials. */
              async function cleanup() { await rm(directory, { recursive: true, force: true }); });
            const runtime = await capture({
              oauth: { scopes: ['probe'], accessTtl: 0.01 },
              storage: new Storage({ namespace: 'issuer', directory, backend: 'file' }),
            });
            t.after(runtime.close);
            const provider = authorize({
              target: runtime.url,
              scope: 'probe',
              storage: new Storage({ namespace: 'client', directory, backend: 'file' }),
              open: browser,
            });
            t.after(provider.close.bind(provider));
            const first = await provider.access();
            const second = await provider.access();
            assert.notEqual(second, first);
            const registration = await provider.clientInformation();
            const revoked = await fetch(new URL('/revoke', runtime.url), {
              method: 'POST',
              body: new URLSearchParams({ client_id: registration.client_id, token: second, token_type_hint: 'access_token' }),
            });
            assert.equal(revoked.status, 200);
            const artifact = runtime.finish();
            assert.ok(artifact.observations.some(
              /**
               * Find the actual SDK refresh token request.
               * @param {import('@mcp-layer/profiles').Evidence} event Sanitized request observation.
               * @returns {boolean} Whether this records a refresh request.
               */
              function refreshed(event) { return event.phase === 'refresh' && event.body?.grant_type === 'refresh_token'; }));
            assert.ok(artifact.observations.some(
              /**
               * Find the actual SDK issuer revocation endpoint request.
               * @param {import('@mcp-layer/profiles').Evidence} event Sanitized request observation.
               * @returns {boolean} Whether this records credential revocation.
               */
              function revocation(event) { return event.phase === 'revocation'; }));
          });
        it('validates transport and required OAuth storage through stable errors',
          /**
           * Verify validates transport and required OAuth storage through stable errors.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function invalid() {
            await assert.rejects(capture({ transport: 'unsupported' }), { code: 'ERR_PROFILES_LISTEN_TRANSPORT', package: '@mcp-layer/profiles', method: 'listen' });
            await assert.rejects(capture({ oauth: true }), { code: 'ERR_PROFILES_LISTEN_STORAGE', package: '@mcp-layer/profiles', method: 'listen' });
            await assert.rejects(capture({ oauth: true, storage: {} }), { code: 'EFORWARD_ISSUER_STORAGE' });
            await assert.rejects(capture({ transport: 'stdio', oauth: true }), { code: 'ERR_PROFILES_LISTEN_TRANSPORT', package: '@mcp-layer/profiles', method: 'listen' });
            await assert.rejects(capture({ transport: 'sse', upstream: 'http://127.0.0.1:1/mcp' }), { code: 'ERR_PROFILES_LISTEN_TRANSPORT', package: '@mcp-layer/profiles', method: 'listen' });
          });
        it('rejects both close and closed when the artifact cannot be written',
          /**
           * Verify rejects both close and closed when the artifact cannot be written.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function unwritable(t) {
            const directory = await mkdtemp(path.join(tmpdir(), 'mcp-cli-output-'));
            t.after(
              /**
               * Release real test resources.
               * @returns {Promise<void>} Completion of the real test operation.
               */
              async function cleanup() { await rm(directory, { recursive: true, force: true }); });
            const runtime = await capture({ output: directory });
            await assert.rejects(runtime.close(), { code: 'ERR_PROFILES_ARTIFACT', package: '@mcp-layer/profiles', method: 'write' });
            await assert.rejects(runtime.closed, { code: 'ERR_PROFILES_ARTIFACT', package: '@mcp-layer/profiles', method: 'write' });
            await assert.rejects(fetch(runtime.url));
          });
      });
  });
