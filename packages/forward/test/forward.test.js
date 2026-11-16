import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { LoggingMessageNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'node:url';
import { build } from '@mcp-layer/test-server';
import { startHttpServer } from '@mcp-layer/test-server/http';
import { forward } from '../src/index.js';

/** Start a real SDK MCP server with request and stream lifecycle observations.
 * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
 * @returns {Promise<{port:number,get initializations():number,get streamClosed():Promise<void>,notify:()=>Promise<void>}>} Running server observations.
 */
async function sdkService(t) {
  const app = express();
  app.use(express.json());
  const server = build();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await server.connect(transport);
  let initializations = 0;
  let finishStream;
  const streamClosed = new Promise(/** @param {() => void} resolve Resolve after the upstream event stream closes. @returns {void} */
  function completion(resolve) { finishStream = resolve; });
  app.all('/mcp', /** @param {import('express').Request} req MCP request. @param {import('express').Response} res MCP response. @param {import('express').NextFunction} next Error continuation. @returns {void} */
  function handle(req, res, next) {
    if (req.body?.method === 'initialize') initializations++;
    if (req.method === 'GET') res.once('close', /** @returns {void} Resolve stream closure. */
    function closed() { finishStream?.(); });
    void transport.handleRequest(req, res, req.body).catch(next);
  });
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(/** @param {() => void} resolve Resolve after listener startup. @param {(error:Error)=>void} reject Reject listener failure. @returns {void} */
  function listening(resolve, reject) { listener.once('listening', resolve); listener.once('error', reject); });
  t.after(/** @returns {Promise<void>} Close SDK server and HTTP listener. */
  async function close() {
    await transport.close();
    await server.close();
    listener.closeAllConnections();
    await new Promise(/** @param {() => void} resolve Resolve after HTTP listener shutdown. @returns {void} */
    function stopped(resolve) { listener.close(resolve); });
  });
  const port = listener.address().port;
  /** Send a real MCP notification to the established SDK session. @returns {Promise<void>} Notification delivery. */
  async function notify() { await server.sendLoggingMessage({ level: 'info', data: 'stream-event-before-close' }, transport.sessionId); }
  return { port, /** @returns {number} Count of actual SDK initialization requests. */ get initializations() { return initializations; }, streamClosed, notify };
}

/** Register real HTTP relay integration tests. @returns {void} */
function suite() {
  it('redacts target query credentials from unauthenticated relay status', /**
   * Verify diagnostic status excludes credentials while preserving upstream routing queries.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function safeStatus(t) {
    let observed;
    const upstream = createServer(/** @param {import('node:http').IncomingMessage} req Incoming request. @param {import('node:http').ServerResponse} res Response. @returns {void} */
    function receive(req, res) { observed = req.url; res.end('ok'); });
    await new Promise(/** @param {() => void} resolve Resolve after listening. @returns {void} */
    function listen(resolve) { upstream.listen(0, '127.0.0.1', resolve); });
    t.after(/** @returns {Promise<void>} Close the local HTTP server. */
    function close() { return new Promise(/** @param {() => void} resolve Resolve after closing. @returns {void} */
    function stop(resolve) { upstream.close(resolve); }); });
    const target = `http://127.0.0.1:${upstream.address().port}/tokens/path-sentinel?api_key=secret#fragment`;
    const runtime = await forward({ target, port: 0, auth: false });
    t.after(runtime.close);
    const status = await runtime.status();
    assert.equal(status.target, `http://127.0.0.1:${upstream.address().port}`);
    assert.doesNotMatch(JSON.stringify(status), /secret|fragment|path-sentinel/);
    await fetch(`${runtime.url}?request=1`);
    assert.equal(observed, '/tokens/path-sentinel?api_key=secret&request=1');
  });

  it('forwards configured endpoint query defaults and lets request values override them', /**
   * Verify a real HTTP upstream receives merged configured and downstream query parameters.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function query(t) {
    let observed;
    const events = [];
    const upstream = createServer(/** @param {import('node:http').IncomingMessage} req Incoming request. @param {import('node:http').ServerResponse} res Response. @returns {void} */
    function receive(req, res) { observed = req.url; res.end('ok'); });
    await new Promise(/** @param {() => void} resolve Resolve after listening. @returns {void} */
    function listen(resolve) { upstream.listen(0, '127.0.0.1', resolve); });
    t.after(/** @returns {Promise<void>} Close the local HTTP server. */
    function close() { return new Promise(/** @param {() => void} resolve Resolve after closing. @returns {void} */
    function stop(resolve) { upstream.close(resolve); }); });
    /** Record actual relay observations. @param {object} event Upstream/downstream event. @returns {void} */
    function observe(event) { events.push(event); }
    const runtime = await forward({ target: `http://127.0.0.1:${upstream.address().port}/mcp?tenant=alpha&mode=default`, port: 0, auth: false, observe });
    t.after(runtime.close);
    const response = await fetch(`${runtime.url}?mode=request&extra=1`);
    assert.equal(response.status, 200);
    assert.equal(observed, '/mcp?tenant=alpha&mode=request&extra=1');
    assert.equal(events.find(/** @param {Record<string,any>} event Observation. @returns {boolean} */
    function forwarded(event) { return event.perspective === 'upstream'; })?.url, `http://127.0.0.1:${upstream.address().port}/mcp?tenant=alpha&mode=request&extra=1`);
  });

  it('bridges an actual stdio subprocess without a duplicate SDK handshake', /**
   * Verify bridges an actual stdio subprocess without a duplicate SDK handshake.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function stdio(t) {
    const upstream = await sdkService(t);
    const link = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('./fixtures/bridge.mjs', import.meta.url)), `http://127.0.0.1:${upstream.port}/mcp?api_key=secret#fragment`], stderr: 'pipe' });
    const client = new Client({ name: 'stdio-client', version: '1.0.0' });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return client.close(); });
    let errors = '';
    /** Collect real child stderr during shutdown. @param {Buffer} chunk - Child output. @returns {void} */
    function collect(chunk) { errors += String(chunk); }
    link.stderr.on('data', collect);
    await client.connect(link);
    assert.equal(upstream.initializations, 1);
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
    assert.match(errors, /bridge-status:\{"target":"http:\/\/127\.0\.0\.1:\d+","auth":false\}/);
    assert.doesNotMatch(errors, /secret|fragment/);
  });

  it('delivers an SDK event before upstream closure and cancels the live stream downstream', /**
   * Verify an unbuffered notification reaches the client before its upstream stream is cancelled.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function stream(t) {
    const upstream = await sdkService(t);
    const gateway = await forward({ target: `http://127.0.0.1:${upstream.port}/mcp`, port: 0, auth: false });
    t.after(gateway.close);
    const client = new Client({ name: 'stream-test', version: '1.0.0' });
    t.after(/** @returns {Promise<void>} Close the downstream SDK client. */
    function close() { return client.close(); });
    let receive;
    const notification = new Promise(/** @param {(value:string)=>void} resolve Resolve with the forwarded event. @returns {void} */
    function waiting(resolve) { receive = resolve; });
    client.setNotificationHandler(LoggingMessageNotificationSchema, /** @param {{params:{data?:unknown}}} message Received SDK notification. @returns {void} */
    function notified(message) { receive(String(message.params.data)); });
    await client.connect(new StreamableHTTPClientTransport(new URL(gateway.url)));
    await client.listTools();
    assert.equal(upstream.initializations, 1);
    await upstream.notify();
    assert.equal(await notification, 'stream-event-before-close');
    const premature = await Promise.race([upstream.streamClosed.then(/** @returns {boolean} */
    function closed() { return true; }), new Promise(/** @param {(value:boolean)=>void} resolve Resolve after the observation window. @returns {void} */
    function delay(resolve) { setTimeout(/** @returns {void} */
    function elapsed() { resolve(false); }, 50); })]);
    assert.equal(premature, false);
    await client.close();
    await upstream.streamClosed;
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
