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
import { derive, listen as capture } from '@mcp-layer/profiles';
import { Storage } from 'cli-storage';
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
      });
  });
