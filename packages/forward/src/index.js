import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { pipeline } from 'node:stream';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createProxyMiddleware, fixRequestBody } from 'http-proxy-middleware';
import express from 'express';
import { LayerError } from '@mcp-layer/error';
import { authorize } from './authorize.js';
import { issuer } from './issuer.js';

export { authorize, issuer };

/**
 * @typedef {object} ForwardOptions
 * @property {string|URL} target - Upstream Streamable HTTP endpoint.
 * @property {import('./authorize.js').Storage} [storage] - Required cli-storage instance when OAuth is enabled.
 * @property {'http'|'stdio'} [transport] - Downstream transport, default http.
 * @property {boolean} [auth] - Enable OAuth, default true.
 * @property {number} [port] - HTTP listen port, default zero.
 * @property {string} [host] - Listen host, default 127.0.0.1.
 * @property {string} [baseUrl] - Advertised issuer origin behind an explicitly configured public endpoint.
 * @property {HeadersInit} [headers] - Upstream identity headers.
 * @property {import('@modelcontextprotocol/sdk/types.js').Implementation} [info] - Optional upstream initialize clientInfo.
 * @property {any} [authProvider] - SDK OAuth provider returned by authorize or decorated by profiles.
 * @property {object} [oauth] - Options passed to authorize, excluding target and storage.
 * @property {typeof fetch} [fetch] - Upstream Fetch implementation for OAuth and stdio HTTP.
 * @property {(event:object)=>void} [observe] - Original and forwarded boundary observations.
 * @property {AbortSignal} [signal] - Close the runtime when aborted.
 */

/**
 * Start a streaming MCP HTTP gateway or stdio-to-HTTP bridge.
 * @param {ForwardOptions} options - Target, optional identity, and OAuth storage settings.
 * @returns {Promise<{url:string|undefined,close:()=>Promise<void>,closed:Promise<void>,status:()=>Promise<object>}>} Owned runtime lifecycle.
 * @throws {LayerError} For invalid transport, missing target, or missing OAuth storage.
 */
export async function forward(options) {
  if (!options || !URL.canParse(String(options.target)) || !['http:', 'https:'].includes(new URL(options.target).protocol)) {
    throw new LayerError({ name: 'forward', method: 'forward', code: 'ERR_TARGET', message: 'Supply an HTTP or HTTPS upstream MCP URL.' });
  }
  if (!['http', 'stdio'].includes(options.transport ?? 'http')) {
    throw new LayerError({ name: 'forward', method: 'forward', code: 'ERR_TRANSPORT', message: 'Forwarding supports http or stdio downstream transports.' });
  }
  if ((options.auth ?? true) && !options.storage) {
    throw new LayerError({ name: 'forward', method: 'forward', code: 'ERR_STORAGE_REQUIRED', message: 'Supply a cli-storage instance for OAuth state.' });
  }
  const provider = (options.auth ?? true) ? options.authProvider ?? authorize({ ...options.oauth, target: options.target, storage: options.storage, fetch: options.fetch, observe: options.observe, signal: options.signal }) : undefined;
  return options.transport === 'stdio' ? bridge(options, provider) : relay(options, provider);
}

/**
 * Classify a parsed downstream OAuth request at the gateway boundary.
 * @param {import('express').Request} request Original SDK endpoint request.
 * @returns {'discovery'|'registration'|'authorization'|'token'|'refresh'|'revocation'} Observed OAuth phase.
 */
function classify(request) {
  if (request.path === '/register') return 'registration';
  if (request.path === '/authorize') return 'authorization';
  if (request.path === '/revoke') return 'revocation';
  if (request.path !== '/token') return 'discovery';
  return request.body?.grant_type === 'refresh_token' ? 'refresh' : 'token';
}

/**
 * Observe original initialization and apply only optional clientInfo metadata.
 * @param {any} message - SDK JSON-RPC message.
 * @param {Pick<ForwardOptions, 'info' | 'observe'>} options - Identity and observer settings.
 * @param {object} [context] - Additional request identity fields.
 * @returns {any} Forwarded message, with negotiation and capabilities preserved.
 */
function identify(message, options, context = {}) {
  options.observe?.({ ...context, phase: 'mcp', perspective: 'downstream', message: structuredClone(message), provenance: { role: 'client' } });
  const outgoing = message?.method === 'initialize' && options.info
    ? { ...message, params: { ...message.params, clientInfo: { ...message.params.clientInfo, ...options.info } } }
    : message;
  options.observe?.({ ...context, phase: 'mcp', perspective: 'upstream', message: structuredClone(outgoing), provenance: { role: 'bridge' } });
  return outgoing;
}

/**
 * Run an SDK transport pair without creating a second client handshake.
 * @param {ForwardOptions} options - Forwarding options.
 * @param {any} provider - Optional OAuth provider.
 * @returns {Promise<{url:undefined,close:()=>Promise<void>,closed:Promise<void>,status:()=>Promise<object>}>} Bridge lifecycle.
 */
async function bridge(options, provider) {
  const local = new StdioServerTransport();
  const remote = new StreamableHTTPClientTransport(new URL(options.target), { fetch: provider?.fetch ?? options.fetch, requestInit: { headers: options.headers } });
  let done;
  let closing;
  const closed = new Promise(/**
   * Retain the runtime shutdown completion callback.
   * @param {() => void} resolve Resolve after owned resources close.
   * @returns {void} Registers the lifecycle completion function.
   */
  function completion(resolve) { done = resolve; });
  /** @returns {Promise<void>} Close both SDK transports once. */
  function close() {
    /** @returns {Promise<void>} Drain owned connections. */
    async function drain() {
      options.signal?.removeEventListener('abort', aborted);
      process.stdin.removeListener('end', aborted);
      await Promise.allSettled([local.close(), remote.close(), provider?.close?.()]);
      done();
    }
    // SDK close callbacks fire synchronously; publish the guard before draining.
    closing ??= Promise.resolve().then(drain);
    return closing;
  }
  /** @returns {void} */
  function aborted() { void close(); }
  /** @param {any} message - Original downstream JSON-RPC. @returns {void} */
  function outgoing(message) { void remote.send(identify(message, options)).catch(aborted); }
  /** @param {any} message - Original upstream JSON-RPC. @returns {void} */
  function incoming(message) {
    if (message.result?.protocolVersion) remote.setProtocolVersion(message.result.protocolVersion);
    void local.send(message).catch(aborted);
  }
  local.onmessage = outgoing;
  remote.onmessage = incoming;
  local.onclose = aborted;
  remote.onclose = aborted;
  local.onerror = aborted;
  remote.onerror = aborted;
  options.signal?.addEventListener('abort', aborted, { once: true });
  process.stdin.once('end', aborted);
  try {
    options.signal?.throwIfAborted();
    await remote.start();
    await local.start();
  } catch (cause) {
    await close();
    throw new LayerError({ name: 'forward', method: 'forward', code: 'ERR_CONNECTION', message: 'The forwarding transports could not be started.', cause });
  }
  /** @returns {Promise<object>} Safe OAuth diagnostics. */
  async function status() { return provider ? provider.status() : { target: String(options.target), auth: false }; }
  return { url: undefined, close, closed, status };
}

/**
 * Host an HTTP proxy with separate downstream grants and upstream credentials.
 * @param {ForwardOptions} options - Runtime options.
 * @param {any} provider - Optional upstream OAuth provider.
 * @returns {Promise<{url:string,close:()=>Promise<void>,closed:Promise<void>,status:()=>Promise<object>}>} HTTP runtime.
 */
async function relay(options, provider) {
  const host = options.host ?? '127.0.0.1';
  const allowedHosts = options.baseUrl ? [new URL(options.baseUrl).hostname, host] : undefined;
  const app = createMcpExpressApp({ host, allowedHosts });
  app.use(express.urlencoded({ extended: false, limit: '4mb' }));
  const listener = app.listen(options.port ?? 0, host);
  await new Promise(/**
   * Await HTTP listener startup.
   * @param {() => void} resolve Resolve once the port is bound.
   * @param {(error: Error) => void} reject Reject a startup failure.
   * @returns {void} Registers listener event handlers.
   */
  function listening(resolve, reject) { listener.once('listening', resolve); listener.once('error', reject); });
  const local = `http://${host.includes(':') ? `[${host}]` : host}:${listener.address().port}`;
  const base = options.baseUrl ?? local;
  const url = new URL('/mcp', base).href;
  let done;
  let closing;
  const closed = new Promise(/**
   * Retain the runtime shutdown completion callback.
   * @param {() => void} resolve Resolve after owned resources close.
   * @returns {void} Registers the lifecycle completion function.
   */
  function completion(resolve) { done = resolve; });
  const target = new URL(options.target);
  const agent = target.protocol === 'https:' ? new HttpsAgent({ keepAlive: true }) : new HttpAgent({ keepAlive: true });

  try {

    /** Observe auth request identity before SDK route processing. @param {any} req - Incoming HTTP request. @param {any} res - HTTP response. @param {()=>void} next - Next handler. @returns {void} */
    function observe(req, res, next) {
      if (req.path === '/mcp') {
        options.observe?.({ phase: 'mcp', perspective: 'downstream', url: new URL(req.originalUrl, base).href, headers: { ...req.headers }, method: req.method, message: structuredClone(req.body), provenance: { role: 'client' } });
      } else {
        const phase = classify(req);
        options.observe?.({ phase, perspective: 'downstream', url: new URL(req.originalUrl, base).href, headers: req.headers, method: req.method, body: req.body, provenance: { role: phase === 'authorization' ? 'browser' : 'client', issuer: base } });
      }
      next();
    }
    app.use(observe);
    if (provider) {
      /** Require upstream authorization before issuing a downstream grant. @returns {Promise<object>} Bound local grant context. */
      async function grant() { await provider.access(); return { upstream: (await provider.discover()).key }; }
      const downstream = issuer({ url: base, resource: url, storage: options.storage, grant, observe: options.observe });
      app.use(mcpAuthRouter({ provider: downstream, issuerUrl: new URL(base), resourceServerUrl: new URL(url), scopesSupported: downstream.scopes }));
      app.use('/mcp', requireBearerAuth({ verifier: downstream, requiredScopes: downstream.scopes, expectedResource: new URL(url), resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(url)) }));
    }

    /** Add fresh upstream credentials and preserve original observations. @param {any} req - MCP request. @param {any} res - Response. @param {(error?:unknown)=>void} next - Next middleware. @returns {Promise<void>} */
    async function prepare(req, res, next) {
      try {
        req.body = identify(req.body, { info: options.info });
        if (provider) req.upstreamToken = await provider.access();
        next();
    } catch (cause) {
      next(new LayerError({ name: 'forward', method: 'forward', code: 'ERR_AUTHORIZATION', message: 'Upstream authorization failed.', cause }));
    }
  }

  /** Pipe a response or make one retry after an upstream 401. @param {any} upstream - Upstream response stream. @param {any} req - Proxy request. @param {any} res - Downstream response. @returns {Promise<void>} */
  async function response(upstream, req, res) {
    if (upstream.statusCode === 401 && provider && !req.retried) {
      req.retried = true;
      upstream.destroy();
      req.upstreamToken = await provider.access({ rejected: req.upstreamToken });
      if (!res.destroyed) proxy(req, res, /**
       * Handle a proxy retry that failed before producing a response.
       * @param {unknown} cause Optional proxy failure.
       * @returns {void} Reports a transport failure when present.
       */
      function retry(cause) { if (cause) failed(cause, req, res); });
      return;
    }
    res.statusCode = upstream.statusCode ?? 502;
    const hop = new Set(['connection', 'keep-alive', 'transfer-encoding', 'proxy-authenticate', 'proxy-authorization', 'proxy-connection', 'te', 'trailer', 'upgrade', ...String(upstream.headers.connection ?? '').toLowerCase().split(',').map(/**
     * Normalize a Connection header token for hop-by-hop filtering.
     * @param {string} value One lowercased header token.
     * @returns {string} Token without surrounding whitespace.
     */
    function trim(value) { return value.trim(); })]);
    for (const [name, value] of Object.entries(upstream.headers)) {
      if (value !== undefined && !hop.has(name)) res.setHeader(name, value);
    }
    pipeline(upstream, res, /**
     * Close an incomplete downstream response after a stream failure.
     * @param {NodeJS.ErrnoException | null} error Pipeline completion error, if any.
     * @returns {void} Destroys an unfinished failed response.
     */
    function piped(error) { if (error && !res.destroyed) res.destroy(error); });
  }
  /** Return a safe transport failure. @param {unknown} error - Internal failure. @param {any} [req] - Request. @param {any} [res] - Response. @returns {void} */
  function failed(error, req, res) {
    if (res && !res.headersSent) res.status(502).json({ error: 'Upstream MCP request failed.' });
    else res?.destroy();
  }
  const proxy = createProxyMiddleware({
    target: target.origin,
    changeOrigin: true,
    agent,
    selfHandleResponse: true,
    /** @param {string} path - Incoming proxy path. @param {any} req - Request. @returns {string} Exact upstream resource path. */
    pathRewrite: function rewrite(path, req) { return `${target.pathname}${new URL(req.originalUrl, base).search}`; },
    on: {
      /** @param {any} upstream - Outgoing native HTTP request. @param {any} req - Original request. @param {any} res - Response. @returns {void} */
      proxyReq: function request(upstream, req, res) {
        for (const [name, value] of new Headers(options.headers)) {
          if (!['authorization', 'cookie', 'host', 'content-length', 'content-type', 'accept', 'mcp-session-id', 'mcp-protocol-version', 'connection', 'transfer-encoding'].includes(name)) upstream.setHeader(name, value);
        }
        if (provider) {
          upstream.removeHeader('cookie');
          upstream.removeHeader('proxy-authorization');
          upstream.setHeader('authorization', `Bearer ${req.upstreamToken}`);
        }
        options.observe?.({ phase: 'mcp', perspective: 'upstream', url: target.href, method: req.method, headers: upstream.getHeaders(), message: structuredClone(req.body), provenance: { role: 'bridge' } });
        fixRequestBody(upstream, req, res);
      },
      /** @param {any} upstream - Upstream response. @param {any} req - Request. @param {any} res - Response. @returns {void} */
      proxyRes: function received(upstream, req, res) { void response(upstream, req, res).catch(/**
       * Report a rejected asynchronous proxy response handler.
       * @param {unknown} cause Upstream response-processing failure.
       * @returns {void} Ends or destroys the downstream response.
       */
      function error(cause) { failed(cause, req, res); }); },
      error: failed,
    },
  });
  app.use('/mcp', prepare, proxy);
  /** @param {unknown} cause - Safe reported error. @param {any} req - Request. @param {any} res - Response. @param {Function} next - Express error continuation. @returns {void} */
  function error(cause, req, res, next) { failed(cause, req, res); }
  app.use(error);
  /** @returns {Promise<void>} Close listeners, proxy sockets, and OAuth interaction. */
  function close() {
    /** @returns {Promise<void>} Idempotent runtime shutdown. */
    async function drain() {
      options.signal?.removeEventListener('abort', aborted);
      listener.closeAllConnections();
      agent.destroy();
      await provider?.close?.();
      await new Promise(/**
       * Await owned HTTP-listener shutdown.
       * @param {() => void} resolve Resolve when listener closure completes.
       * @returns {void} Starts listener closure.
       */
      function stopped(resolve) { listener.close(resolve); });
      done();
    }
    closing ??= Promise.resolve().then(drain);
    return closing;
  }
  /** @returns {void} */
  function aborted() { void close(); }
  options.signal?.addEventListener('abort', aborted, { once: true });
  if (options.signal?.aborted) await close();
  /** @returns {Promise<object>} Safe diagnostics. */
  async function status() { return provider ? provider.status() : { target: target.href, auth: false }; }
  return { url, close, closed, status };
  } catch (cause) {
    listener.closeAllConnections();
    agent.destroy();
    await provider?.close?.();
    await new Promise(/**
     * Await owned HTTP-listener shutdown.
     * @param {() => void} resolve Resolve when listener closure completes.
     * @returns {void} Starts listener closure.
     */
    function stopped(resolve) { listener.close(resolve); });
    throw cause;
  }
}
