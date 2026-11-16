import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { authorize } from '@mcp-layer/forward';
import { derive } from '@mcp-layer/profiles';
import { Storage } from 'cli-storage';
import { capture } from '../src/capture.js';
import { host } from './fixtures/process.mjs';
import { browser } from './fixtures/browser.mjs';

const bin = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const oauthbin = fileURLToPath(new URL('./fixtures/oauth-cli.mjs', import.meta.url));

describe('cli',
  /**
   * Register cli integration coverage.
   * @returns {void} Completion of the real test operation.
   */
  function suite() {
    describe('forwarding',
      /**
       * Register forwarding integration coverage.
       * @returns {void} Completion of the real test operation.
       */
      function forwarding() {
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
            const runtime = await host(t, ['profiles', 'capture', '--upstream', upstream.url, '--oauth', '--output', output, '--storage-dir', path.join(directory, 'gateway'), '--storage-backend', 'file'], oauthbin);
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
        it('runs an HTTP gateway until SIGTERM with protocol output preserved',
          /**
           * Verify runs an HTTP gateway until SIGTERM with protocol output preserved.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function gateway(t) {
            const upstream = await capture();
            t.after(upstream.close);
            const runtime = await host(t, ['forward', upstream.url, '--no-oauth']);
            const client = new Client({ name: 'gateway-client', version: '1.0.0' });
            await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url)));
            assert.equal((await client.listTools()).tools[0].name, 'probe');
            await client.close();
            await runtime.close();
            assert.equal(runtime.stdout(), '');
          });
        it('keeps the stdio gateway stdout parseable by the SDK',
          /**
           * Verify keeps the stdio gateway stdout parseable by the SDK.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function stdio(t) {
            const upstream = await capture();
            t.after(upstream.close);
            const client = new Client({ name: 'stdio-gateway', version: '1.0.0' });
            await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin, 'forward', upstream.url, '--transport', 'stdio', '--no-oauth'], stderr: 'pipe' }));
            assert.equal((await client.listTools()).tools[0].name, 'probe');
            await client.close();
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
            const runtime = await host(t, ['profiles', 'capture', '--upstream', upstream.url, '--output', output]);
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
