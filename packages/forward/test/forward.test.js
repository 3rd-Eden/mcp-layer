import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { startHttpServer } from '@mcp-layer/test-server/http';
import { forward } from '../src/index.js';

/** Register real HTTP relay integration tests. @returns {void} */
function suite() {
  it('bridges an actual stdio subprocess without a duplicate SDK handshake', /**
   * Verify bridges an actual stdio subprocess without a duplicate SDK handshake.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function stdio(t) {
    const upstream = await startHttpServer({ port: 0 });
    t.after(upstream.close);
    const link = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./fixtures/bridge.mjs', import.meta.url)), `http://127.0.0.1:${upstream.port}/mcp`], stderr: 'pipe' });
    const client = new Client({ name: 'stdio-client', version: '1.0.0' });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return client.close(); });
    await client.connect(link);
    let errors = '';
    /** Collect real child stderr during shutdown. @param {Buffer} chunk - Child output. @returns {void} */
    function collect(chunk) { errors += String(chunk); }
    link.stderr.on('data', collect);
    assert.ok((await client.listTools()).tools.length > 0);
    const pid = link.pid;
    await client.close();
    assert.equal(link.pid, null);
    assert.throws(/**
     * Check that the owned subprocess no longer exists.
     * @returns {void} Throw the expected validation or process error.
     */
    function exited() { process.kill(pid, 0); }, { code: 'ESRCH' });
    assert.doesNotMatch(errors, /RangeError|Maximum call stack|Unhandled/);
    assert.match(errors, /bridge-closed:eof/);
  });
  it('relays one initialization and tool calls, then closes both sides', /**
   * Verify relays one initialization and tool calls, then closes both sides.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function relay(t) {
    const upstream = await startHttpServer({ port: 0 });
    t.after(upstream.close);
    const events = [];
    /** Collect observed boundary messages. @param {object} event - Observation. @returns {void} */
    function observe(event) { events.push(event); }
    const gateway = await forward({ target: `http://127.0.0.1:${upstream.port}/mcp`, port: 0, auth: false, observe });
    t.after(gateway.close);
    const client = new Client({ name: 'relay-test', version: '1.0.0' });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return client.close(); });
    await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
    const result = await client.listTools();
    assert.ok(result.tools.length > 0);
    assert.equal(events.filter(/**
     * Select original initialization evidence.
     * @param {Record<string, any>} event Actual boundary observation.
     * @returns {boolean} Whether the observation matches.
     */
    function initialized(event) { return event.perspective === 'downstream' && event.message?.method === 'initialize'; }).length, 1);
    await client.close();
    await gateway.close();
    await gateway.closed;
  });

  it('applies upstream clientInfo without replacing capabilities or original observations', /**
   * Verify applies upstream clientInfo without replacing capabilities or original observations.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function identity(t) {
    const upstream = await startHttpServer({ port: 0 });
    t.after(upstream.close);
    const events = [];
    /** Record upstream and downstream identities. @param {object} event - Observation. @returns {void} */
    function observe(event) { events.push(event); }
    const gateway = await forward({ target: `http://127.0.0.1:${upstream.port}/mcp`, port: 0, auth: false, info: { name: 'captured-client', version: '2.0.0' }, observe });
    t.after(gateway.close);
    const client = new Client({ name: 'actual-client', version: '1.0.0' });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return client.close(); });
    await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
    const before = events.find(/**
     * Select original initialization evidence.
     * @param {Record<string, any>} event Actual boundary observation.
     * @returns {boolean} Whether the observation matches.
     */
    function original(event) { return event.perspective === 'downstream' && event.message?.method === 'initialize'; });
    const after = events.find(/**
     * Select forwarded initialization evidence.
     * @param {Record<string, any>} event Actual boundary observation.
     * @returns {boolean} Whether the observation matches.
     */
    function rewritten(event) { return event.perspective === 'upstream' && event.message?.method === 'initialize'; });
    assert.equal(before.message.params.clientInfo.name, 'actual-client');
    assert.equal(after.message.params.clientInfo.name, 'captured-client');
    assert.deepEqual(after.message.params.capabilities, before.message.params.capabilities);
  });
}

describe('@mcp-layer/forward', suite);
