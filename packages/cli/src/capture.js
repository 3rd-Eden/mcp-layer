import { randomUUID } from 'node:crypto';
import { capture as record } from '@mcp-layer/profiles';
import { forward, issuer } from '@mcp-layer/forward';
import { LayerError } from '@mcp-layer/error';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import express from 'express';
import { write } from './artifact.js';

/**
 * @typedef {object} CaptureOptions
 * @property {import('@mcp-layer/profiles').Identity} [client] Optional declared client name, version and platform.
 * @property {string} [capturedAt] Capture timestamp for reproducible artifacts.
 * @property {string[]} [allowHeaders] Explicit public custom header allowlist.
 * @property {'http'|'sse'|'stdio'} [transport] Downstream transport, default HTTP with `/mcp` and legacy `/sse` endpoints.
 * @property {string} [host] Listen host; defaults to `127.0.0.1`.
 * @property {number} [port] Listen port; defaults to zero.
 * @property {string} [baseUrl] Public origin advertised to remote clients.
 * @property {boolean|Omit<Parameters<typeof issuer>[0], 'url'|'resource'|'storage'>} [oauth] Enable OAuth; controlled HTTP captures also accept issuer scopes, lifetimes, and preregistration settings.
 * @property {import('cli-storage').Storage} [storage] Application-owned storage required for OAuth.
 * @property {string} [upstream] Forward to an existing Streamable HTTP server instead of the controlled probe server.
 * @property {import('@mcp-layer/forward').ForwardOptions['oauth']} [authorization] Upstream OAuth runtime options when forwarding.
 * @property {ReturnType<typeof import('@mcp-layer/forward').authorize>} [authProvider] Existing upstream authorize provider with access, fetch, status and close methods.
 * @property {HeadersInit} [headers] Upstream public identity headers when forwarding.
 * @property {import('@modelcontextprotocol/sdk/types.js').Implementation} [info] Upstream initialize identity when forwarding.
 * @property {typeof fetch} [fetch] Upstream fetch implementation when forwarding.
 * @property {string} [output] Write sanitized canonical capture JSON when closed.
 * @property {AbortSignal} [signal] Close when aborted.
 */

/**
 * Create the controlled MCP server used to observe a client's handshake.
 * @returns {McpServer} SDK server with a harmless, argument-free probe tool.
 */
function probe() {
  const server = new McpServer({ name: 'mcp-layer-capture', version: '1.0.0' });
  /** @returns {Promise<{content:Array<{type:'text',text:string}>}>} Harmless probe completion. */
  async function complete() { return { content: [{ type: 'text', text: 'Capture probe completed.' }] }; }
  server.registerTool('probe', { description: 'Complete a harmless client identity capture probe.', inputSchema: {} }, complete);
  return server;
}

/**
 * Classify an observed request without inspecting or consuming its transport stream.
 * @param {import('express').Request} request Parsed SDK endpoint request.
 * @returns {import('@mcp-layer/profiles').Phase} Capture phase for the original request.
 */
function classify(request) {
  if (['/mcp', '/sse', '/messages'].includes(request.path)) return 'mcp';
  if (request.path === '/register') return 'registration';
  if (request.path === '/authorize') return 'authorization';
  if (request.path === '/revoke') return 'revocation';
  if (request.path !== '/token') return 'discovery';
  return request.body?.grant_type === 'refresh_token' ? 'refresh' : 'token';
}

/**
 * Run a controlled SDK MCP server or observe a forwarding gateway.
 * @param {CaptureOptions} [options={}] Endpoint, recorder, output and optional OAuth settings.
 * @returns {Promise<{url:string|undefined, close:()=>Promise<void>, closed:Promise<void>, finish:()=>import('@mcp-layer/profiles').Capture}>} Composable capture lifecycle and sanitized snapshot function.
 * @throws {LayerError} For unsupported transports, missing OAuth storage, invalid capture options or artifact writes. SDK startup failures propagate.
 */
export async function capture(options = {}) {
  const mode = options.transport ?? 'http';
  if (!['http', 'sse', 'stdio'].includes(mode) || (options.oauth && mode === 'stdio' && !options.upstream)) {
    throw new LayerError({ name: 'cli', method: 'capture', code: 'ERR_CLI_CAPTURE_TRANSPORT', message: 'Capture supports http, sse or stdio; controlled OAuth capture requires HTTP.' });
  }
  if (options.oauth && !options.storage) {
    throw new LayerError({ name: 'cli', method: 'capture', code: 'ERR_CLI_CAPTURE_STORAGE', message: 'Supply cli-storage for OAuth capture.' });
  }
  const recorder = record({ client: options.client, capturedAt: options.capturedAt, allowHeaders: options.allowHeaders });
  let runtime;
  if (options.upstream) {
    runtime = await forward({
      target: options.upstream,
      storage: options.storage,
      transport: mode === 'stdio' ? 'stdio' : 'http',
      auth: Boolean(options.oauth),
      host: options.host,
      port: options.port,
      baseUrl: options.baseUrl,
      headers: options.headers,
      info: options.info,
      authProvider: options.authProvider,
      fetch: options.fetch,
      oauth: options.authorization,
      observe: recorder.observe,
    });
  } else {
    runtime = await host(options, recorder);
  }
  let closing;
  let done;
  let failed;
  /** @param {()=>void} resolve Complete capture shutdown. @param {(cause:unknown)=>void} reject Report shutdown/export failure. @returns {void} Capture lifecycle continuations. */
  function completion(resolve, reject) { done = resolve; failed = reject; }
  /** @returns {void} Keep the separately exposed closed promise from becoming an unhandled rejection. */
  function handled() {}
  const closed = new Promise(completion);
  closed.catch(handled);
  /** @returns {Promise<void>} Close all owned listeners and write only sanitized evidence. */
  function close() {
    /** @returns {Promise<void>} Complete one shutdown and export operation. */
    async function drain() {
      options.signal?.removeEventListener('abort', aborted);
      try {
        await runtime.close();
        if (options.output) await write(options.output, recorder.finish());
        done();
      } catch (cause) {
        failed(cause);
        throw cause;
      }
    }
    closing ??= drain();
    return closing;
  }
  /** @returns {void} Begin shutdown after cancellation or underlying transport closure. */
  function aborted() { void close().catch(handled); }
  runtime.closed.then(aborted, aborted);
  options.signal?.addEventListener('abort', aborted, { once: true });
  if (options.signal?.aborted) await close();
  return { url: runtime.url, close, closed, finish: recorder.finish };
}

/**
 * Host controlled transports, with a new SDK server for every client session.
 * @param {CaptureOptions} options Endpoint and optional OAuth settings.
 * @param {import('@mcp-layer/profiles').Recorder} recorder Sanitizing boundary recorder.
 * @returns {Promise<{url:string|undefined, close:()=>Promise<void>, closed:Promise<void>}>} Controlled transport lifecycle.
 */
async function host(options, recorder) {
  const sessions = new Map();
  let listener;
  let ending;
  let done;
  let closing;
  /** @param {()=>void} resolve Complete the controlled transport lifecycle. @returns {void} Retain completion for shutdown. */
  function completion(resolve) { done = resolve; }
  const closed = new Promise(completion);
  /** @returns {Promise<void>} Close each SDK server, then its owned HTTP listener. */
  function close() {
    /** @returns {Promise<void>} Drain all active sessions once. */
    async function drain() {
      if (ending) process.stdin.removeListener('end', ending);
      for (const session of sessions.values()) await session.server.close();
      sessions.clear();
      if (listener) {
        listener.closeAllConnections();
        /** @param {()=>void} resolve Complete listener shutdown. @returns {void} Close the owned listener. */
        function stopped(resolve) { listener.close(resolve); }
        await new Promise(stopped);
      }
      done();
    }
    closing ??= drain();
    return closing;
  }
  if (options.transport === 'stdio') {
    const server = probe();
    const transport = new StdioServerTransport();
    sessions.set('stdio', { server, transport });
    await server.connect(transport);
    const message = transport.onmessage;
    /** @param {any} value Original JSON-RPC message. @param {any} extra SDK request context. @returns {void} Record before SDK dispatch. */
    function observed(value, extra) {
      recorder.observe({ phase: 'mcp', perspective: 'downstream', message: value, provenance: { role: 'client' } });
      message?.(value, extra);
    }
    transport.onmessage = observed;
    const ended = transport.onclose;
    /** @returns {void} Complete capture when stdin or the transport closes. */
    function stopped() { ended?.(); done(); }
    transport.onclose = stopped;
    ending = stopped;
    // The SDK owns protocol parsing but does not close its transport on stdin EOF.
    process.stdin.once('end', stopped);
    return { url: undefined, close, closed };
  }
  const name = options.host ?? '127.0.0.1';
  const app = createMcpExpressApp({ host: name, allowedHosts: options.baseUrl ? [name, new URL(options.baseUrl).hostname] : undefined });
  app.use(express.urlencoded({ extended: false }));
  listener = app.listen(options.port ?? 0, name);
  try {
    /** @param {()=>void} resolve Listener started. @param {(cause:unknown)=>void} reject Listen failure. @returns {void} Bind startup events. */
    function listening(resolve, reject) { listener.once('listening', resolve); listener.once('error', reject); }
    await new Promise(listening);
    const origin = options.baseUrl ?? `http://${name.includes(':') ? `[${name}]` : name}:${listener.address().port}`;
    const resource = new URL('/mcp', origin);
    /**
     * Capture original request headers and bodies before SDK protocol handling.
     * @param {import('express').Request} req Original request.
     * @param {import('express').Response} res Response to observe public registration metadata.
     * @param {import('express').NextFunction} next Continue to SDK routes.
     * @returns {void} Sanitizes observations synchronously before anything is exported.
     */
    function observe(req, res, next) {
      const phase = classify(req);
      const provenance = { role: phase === 'authorization' ? 'browser' : 'client', issuer: new URL('/', origin).href };
      recorder.observe({ phase, perspective: 'downstream', headers: req.headers, url: new URL(req.originalUrl, origin), method: req.method, ...(phase === 'mcp' ? { message: req.body } : { body: req.body }), provenance });
      if (phase === 'registration') {
        const original = res.json;
        /** @param {any} body SDK registration response. @returns {import('express').Response} Original response after public evidence is sanitized. */
        function registered(body) {
          recorder.observe({ phase, perspective: 'downstream', status: res.statusCode, body, provenance });
          return original.call(res, body);
        }
        res.json = registered;
      }
      next();
    }
    app.use(observe);
    if (options.oauth) {
      const settings = typeof options.oauth === 'object' ? options.oauth : {};
      const provider = issuer({ ...settings, url: origin, resource, storage: options.storage });
      app.use(mcpAuthRouter({ provider, issuerUrl: new URL(origin), resourceServerUrl: resource, scopesSupported: provider.scopes }));
      const guard = requireBearerAuth({ verifier: provider, expectedResource: resource, requiredScopes: provider.scopes, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resource) });
      app.use(['/mcp', '/sse', '/messages'], guard);
    }
    /**
     * Route Streamable HTTP sessions through official SDK transports.
     * @param {import('express').Request} req SDK request.
     * @param {import('express').Response} res SDK response.
     * @returns {Promise<void>} Handled JSON-RPC request.
     */
    async function mcp(req, res) {
      const id = req.get('mcp-session-id');
      let session = sessions.get(id);
      if (!session && req.method === 'POST' && !id && isInitializeRequest(req.body)) {
        const server = probe();
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
        session = { server, transport };
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
        if (transport.sessionId) sessions.set(transport.sessionId, session);
        return;
      }
      if (!session) { res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Initialize a capture session first.' }, id: null }); return; }
      await session.transport.handleRequest(req, res, req.body);
    }
    /** @param {import('express').Request} req SSE bootstrap. @param {import('express').Response} res Streaming response. @returns {Promise<void>} Started legacy SDK session. */
    async function sse(req, res) {
      const server = probe();
      const transport = new SSEServerTransport('/messages', res);
      sessions.set(transport.sessionId, { server, transport });
      await server.connect(transport);
    }
    /** @param {import('express').Request} req SSE postback. @param {import('express').Response} res SDK response. @returns {Promise<void>} Handled legacy JSON-RPC. */
    async function message(req, res) {
      const session = sessions.get(req.query.sessionId);
      if (!session) { res.status(400).send('Unknown capture session.'); return; }
      await session.transport.handlePostMessage(req, res, req.body);
    }
    app.all('/mcp', mcp);
    app.get('/sse', sse);
    app.post('/messages', message);
    return { url: options.transport === 'sse' ? new URL('/sse', origin).href : resource.href, close, closed };
  } catch (cause) {
    await close();
    throw cause;
  }
}
