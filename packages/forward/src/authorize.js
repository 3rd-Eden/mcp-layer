import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { auth, discoverAuthorizationServerMetadata, discoverOAuthServerInfo } from '@modelcontextprotocol/sdk/client/auth.js';
import { redirectUriMatches } from '@modelcontextprotocol/sdk/server/auth/handlers/authorize.js';
import { LayerError } from '@mcp-layer/error';

/**
 * @typedef {object} Storage
 * @property {(key:string) => Promise<any>} get - Read a record.
 * @property {(key:string,value:any) => Promise<void>} set - Replace a record.
 * @property {(key:string) => Promise<boolean>} delete - Delete a record.
 * @property {(key:string,work:(lease:Lease)=>Promise<any>,options?:object)=>Promise<any>} lock - Run with an exclusive lease.
 * @property {(key?:string)=>Promise<object>} status - Inspect storage without creating it.
 */
/**
 * @typedef {object} Lease
 * @property {()=>Promise<any>} get - Read the leased record.
 * @property {(value:any)=>Promise<void>} set - Replace the leased record.
 * @property {()=>Promise<boolean>} delete - Delete the leased record.
 */
/**
 * @typedef {object} AuthorizationOptions
 * @property {string|URL} target - Upstream MCP resource URL.
 * @property {Storage} storage - cli-storage instance; no fallback store is created.
 * @property {string} [issuer] - Explicit authorization server override.
 * @property {string} [resource] - Explicit resource indicator.
 * @property {string} [scope] - Explicit requested scope.
 * @property {object} [clientMetadata] - Public OAuth registration metadata.
 * @property {object} [clientInformation] - Issuer-bound preregistered client information.
 * @property {string} [clientMetadataUrl] - HTTPS client ID metadata document.
 * @property {string} [redirectUrl] - Loopback callback URL; port zero chooses an available port.
 * @property {number} [callbackPort] - Loopback callback port override.
 * @property {number} [authTimeout] - Interaction and lock timeout in milliseconds, default 300000.
 * @property {(url:URL)=>Promise<void>} [open] - Open the browser or perform an application-owned redirect.
 * @property {typeof fetch} [fetch] - Fetch implementation for upstream OAuth and MCP traffic.
 * @property {(event:object)=>void} [observe] - Observe request identity metadata.
 * @property {AbortSignal} [signal] - Cancel outstanding authorization.
 */

/**
 * Create an OAuth client provider with cli-storage persistence and SDK authorization.
 * @param {AuthorizationOptions} options - Resource, store, and interactive login settings.
 * @returns {Authorization} SDK-compatible provider with access, fetch, status, and close methods.
 * @throws {LayerError} When a URL or required storage API is invalid.
 */
export function authorize(options) {
  return new Authorization(options);
}

/** OAuth business records and browser lifecycle; persistence is delegated to cli-storage. */
class Authorization {
  /**
   * @param {AuthorizationOptions} options - Resource and storage configuration.
   */
  constructor(options) {
    if (!options?.storage?.lock || !options.storage.get || !options.storage.status) {
      throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_STORAGE_REQUIRED', message: 'Supply a cli-storage instance for OAuth state.' });
    }
    const target = URL.canParse(String(options.target)) ? new URL(options.target) : undefined;
    if (!target || !['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash) {
      throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_TARGET', message: 'Supply an HTTP or HTTPS upstream MCP URL.' });
    }
    this.options = options;
    this.target = String(options.target);
    this.storage = options.storage;
    this.context = new AsyncLocalStorage();
    const redirect = options.redirectUrl ?? 'http://127.0.0.1:0/callback';
    if (!URL.canParse(redirect)) {
      throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_CALLBACK', message: 'Use an HTTP loopback OAuth callback URL.' });
    }
    this.redirect = new URL(redirect);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(this.redirect.hostname) || this.redirect.protocol !== 'http:' || this.redirect.username || this.redirect.password || this.redirect.hash ||
      (options.callbackPort !== undefined && (!Number.isInteger(options.callbackPort) || options.callbackPort < 0 || options.callbackPort > 65535))) {
      throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_CALLBACK', message: 'Use an HTTP loopback OAuth callback URL.' });
    }
    if (options.authTimeout !== undefined && (!Number.isFinite(options.authTimeout) || options.authTimeout <= 0)) {
      throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_OAUTH_OPTIONS', message: 'Use a positive finite OAuth interaction timeout in milliseconds.' });
    }
    if (options.callbackPort !== undefined) this.redirect.port = String(options.callbackPort);
    this.port = this.redirect.port;
    this.clientMetadataUrl = options.clientMetadataUrl;
    this.timeout = options.authTimeout ?? 300000;
    this.transport = undefined;
    this.pending = undefined;
    this.discovered = undefined;
    this.fetch = this.fetch.bind(this);
    if (options.resource !== undefined) {
      /** @returns {Promise<URL>} Explicit caller-owned OAuth resource indicator. */
      this.validateResourceURL = async function resource() { return new URL(options.resource); };
    }
  }

  /** @returns {string} Current loopback callback URL. */
  get redirectUrl() { return this.redirect.href; }

  /** @returns {import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientMetadata} Public metadata using the live callback. */
  get clientMetadata() {
    return {
      client_name: 'mcp-layer',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...this.options.clientMetadata,
      ...(this.options.scope !== undefined ? { scope: this.options.scope } : {}),
      redirect_uris: [this.redirectUrl],
    };
  }

  /**
   * Discover with SDK helpers and derive an issuer/resource/registration-specific record key.
   * @returns {Promise<{key:string,state:object}>} Bound discovery context.
   */
  async discover() {
    if (this.discovered) return this.discovered;
    const provider = this;
    /** @returns {Promise<{key:string,state:object}>} Validated discovery context. */
    async function discover() {
      const source = provider.request.bind(provider);
      let info;
      if (provider.options.issuer) {
        info = {
          authorizationServerUrl: provider.options.issuer,
          authorizationServerMetadata: await discoverAuthorizationServerMetadata(provider.options.issuer, { fetchFn: source }),
          resourceMetadata: { resource: provider.options.resource ?? provider.target, authorization_servers: [provider.options.issuer] },
        };
      } else {
        info = await discoverOAuthServerInfo(provider.target, { fetchFn: source });
      }
      const issuer = String(info.authorizationServerUrl);
      const expected = provider.options.clientInformation?.issuer;
      if (expected !== undefined && new URL(expected).href !== new URL(issuer).href) {
        throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_OAUTH_ISSUER', message: 'The configured OAuth client belongs to a different issuer.' });
      }
      const metadata = { ...provider.clientMetadata };
      delete metadata.redirect_uris;
      const callback = new URL(provider.redirectUrl);
      callback.port = '';
      const scope = provider.options.scope ?? info.resourceMetadata?.scopes_supported?.join(' ') ?? provider.clientMetadata.scope ?? '';
      const identity = JSON.stringify({ target: provider.target, issuer, resource: provider.options.resource ?? info.resourceMetadata?.resource ?? provider.target, scope: [...new Set(scope.split(/\s+/).filter(Boolean))].sort(), metadata, client: provider.options.clientInformation?.client_id, callback: callback.href, metadataUrl: provider.clientMetadataUrl });
      return { key: `forward:authorization:${createHash('sha256').update(identity).digest('hex')}`, state: info };
    }
    this.discovered = discover();
    return this.discovered;
  }

  /** @returns {Promise<any>} Current OAuth business record read through cli-storage. */
  async read() {
    const lease = this.context.getStore();
    return (lease ? await lease.get() : await this.storage.get((await this.discover()).key)) ?? {};
  }

  /**
   * Merge an OAuth record under the store's exclusive lease.
   * @param {object} patch - Business fields to replace or delete with undefined.
   * @returns {Promise<void>} Saved record.
   */
  async update(patch) {
    const current = this.context.getStore();
    /** @param {Lease} lease - Exclusive record lease. @returns {Promise<void>} */
    async function update(lease) {
      const record = { ...(await lease.get() ?? {}) };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete record[key];
        else record[key] = value;
      }
      await lease.set(record);
    }
    if (current) return update(current);
    await this.storage.lock((await this.discover()).key, update, { signal: this.options.signal, timeout: this.timeout });
  }

  /** @returns {Promise<object|undefined>} SDK discovery cache from cli-storage or current discovery. */
  async discoveryState() { return (await this.read()).discovery ?? (await this.discover()).state; }
  /** @param {object} value - SDK discovery state. @returns {Promise<void>} */
  async saveDiscoveryState(value) {
    const discovery = {};
    for (const [key, field] of Object.entries(value)) if (field !== undefined) discovery[key] = field;
    await this.update({ discovery });
  }
  /** @returns {Promise<any>} Issuer-bound client registration. */
  async clientInformation() {
    await this.prepare();
    const record = await this.read();
    const client = record.client ?? (this.options.clientInformation ? { ...this.options.clientInformation, issuer: String((await this.discover()).state.authorizationServerUrl) } : undefined);
    if (Array.isArray(client?.redirect_uris) && !client.redirect_uris.some(
      /**
       * Compare the live callback with an issuer-registered redirect URI.
       * @param {string} registered Registered callback URL.
       * @returns {boolean} Whether the SDK accepts the callback, including loopback port changes.
       */
      function compatible(registered) { return redirectUriMatches(String(this.redirectUrl), registered); }, this)) {
      throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_OAUTH_REGISTRATION', message: 'The OAuth registration does not allow the current callback URL. Use a registered callback host and path or register a new client.' });
    }
    return client;
  }
  /** @param {object} client - SDK-issued registration including its issuer. @returns {Promise<void>} */
  async saveClientInformation(client) { await this.update({ client }); }
  /** @returns {Promise<any>} Current upstream tokens. */
  async tokens() { return (await this.read()).tokens; }
  /** @param {any} tokens - SDK-issued tokens including their issuer. @returns {Promise<void>} */
  async saveTokens(tokens) {
    const previous = await this.read();
    const refresh = tokens.refresh_token ?? previous.tokens?.refresh_token;
    await this.update({ tokens: { ...tokens, ...(refresh === undefined ? {} : { refresh_token: refresh }) }, expires: tokens.expires_in === undefined ? null : Date.now() + tokens.expires_in * 1000 });
  }
  /** @param {string} verifier - Fresh SDK PKCE verifier. @returns {Promise<void>} */
  async saveCodeVerifier(verifier) { await this.update({ verifier }); }
  /** @returns {Promise<string>} Stored SDK PKCE verifier. */
  async codeVerifier() { return (await this.read()).verifier; }
  /** @returns {Promise<string>} Fresh state bound to this authorization transaction. */
  async state() {
    const state = randomBytes(32).toString('base64url');
    await this.update({ state });
    return state;
  }
  /** @param {'all'|'client'|'tokens'|'verifier'} scope - SDK invalidation scope. @returns {Promise<void>} */
  async invalidateCredentials(scope) {
    const patch = scope === 'all' ? { client: undefined, tokens: undefined, verifier: undefined, state: undefined, discovery: undefined } : scope === 'client' ? { client: undefined } : scope === 'tokens' ? { tokens: undefined, expires: undefined } : { verifier: undefined };
    await this.update(patch);
  }

  /**
   * Bind the callback before registration so the live redirect URI reaches the issuer.
   * @returns {Promise<void>} Listening callback server.
   */
  async prepare() {
    if (this.transport) return;
    const provider = this;
    /** @param {import('node:http').IncomingMessage} req - Browser callback. @param {import('node:http').ServerResponse} res - Browser response. @returns {Promise<void>} */
    async function callback(req, res) {
      const url = new URL(req.url ?? '/', provider.redirect);
      if (url.pathname !== provider.redirect.pathname) { res.writeHead(404).end(); return; }
      const expected = (await provider.read()).state;
      const actual = url.searchParams.get('state');
      const valid = typeof expected === 'string' && actual !== null && Buffer.byteLength(expected) === Buffer.byteLength(actual) && timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
      if (provider.pending && valid && url.searchParams.has('error')) {
        provider.pending.reject(new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_OAUTH_DENIED', message: 'The authorization server did not approve this OAuth request.', oauthCode: url.searchParams.get('error') }));
        res.writeHead(400).end('OAuth authorization was not approved.');
        return;
      }
      if (!provider.pending || !valid || !url.searchParams.get('code')) {
        res.writeHead(400).end('OAuth authorization was not accepted.');
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.end('Authorization received. You can close this tab.');
      provider.pending.resolve(url.searchParams.get('code'));
    }
    const listener = createServer(/**
     * Dispatch the loopback callback and contain handler failures.
     * @param {import('node:http').IncomingMessage} req Browser callback request.
     * @param {import('node:http').ServerResponse} res Browser callback response.
     * @returns {void} Starts asynchronous callback processing.
     */
    function request(req, res) {
      void callback(req, res).catch(/**
       * Report an internal callback handler failure to the browser.
       * @returns {void} Ends the callback response.
       */
      function failed() { res.writeHead(500).end('OAuth callback failed.'); });
    });
    await new Promise(/**
     * Bind the loopback callback before registering its live redirect URI.
     * @param {() => void} resolve Resolve after the listener binds.
     * @param {(error: Error) => void} reject Reject a listener startup failure.
     * @returns {void} Registers startup event handlers.
     */
    function listen(resolve, reject) {
      listener.once('error', reject);
      listener.listen(Number(provider.redirect.port), provider.redirect.hostname === '[::1]' ? '::1' : provider.redirect.hostname, resolve);
    });
    this.transport = listener;
    this.redirect.port = String(listener.address().port);
  }

  /**
   * Start an application-owned browser interaction and await its callback.
   * @param {URL} url - SDK-generated authorization URL.
   * @returns {Promise<void>} Callback received; access() exchanges its code through the SDK.
   */
  async redirectToAuthorization(url) {
    if (!this.options.open) {
      throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_OAUTH_INTERACTION', message: 'Supply an open callback to complete interactive OAuth authorization.' });
    }
    const provider = this;
    const promise = new Promise(/**
     * Retain the active callback promise settlement functions.
     * @param {(code: string) => void} resolve Resolve with the validated authorization code.
     * @param {(error: unknown) => void} reject Reject a denied, cancelled, or expired interaction.
     * @returns {void} Installs the pending interaction.
     */
    function pending(resolve, reject) { provider.pending = { resolve, reject, promise: undefined }; });
    this.pending.promise = promise;
    // Attach rejection handling before the browser can fail or cancellation can fire.
    promise.catch(/**
     * Observe early interaction rejection until the awaiting browser flow handles it.
     * @returns {void} Leaves error propagation to the awaited original promise.
     */
    function handled() {});
    const timer = setTimeout(/**
     * Reject a browser interaction that exceeded its deadline.
     * @returns {void} Settles the active interaction as timed out.
     */
    function timeout() {
      provider.pending?.reject(new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_OAUTH_TIMEOUT', message: 'OAuth authorization did not complete before the interaction timeout.' }));
    }, this.timeout);
    /** Reject the pending browser interaction. @returns {void} */
    function abort() { provider.pending?.reject(provider.options.signal.reason); }
    this.options.signal?.addEventListener('abort', abort, { once: true });
    try {
      this.options.signal?.throwIfAborted();
      await Promise.all([this.options.open(url), promise]);
    } finally {
      clearTimeout(timer);
      this.options.signal?.removeEventListener('abort', abort);
    }
  }

  /**
   * Obtain fresh upstream credentials while cli-storage serializes login and refresh.
   * @param {{rejected?:string}} [options] - Previously rejected token, if retrying one request.
   * @returns {Promise<string>} Usable upstream access token.
   */
  async access(options = {}) {
    const provider = this;
    const discovery = await this.discover();
    /** @param {Lease} lease - Exclusive credential lease. @returns {Promise<string>} */
    async function exclusive(lease) {
      /** @returns {Promise<string>} SDK authorization result. */
      async function obtain() {
        const record = await provider.read();
        const valid = record.tokens?.access_token && (record.expires === null || record.expires > Date.now() + 60000);
        if (valid && (options.rejected === undefined || options.rejected !== record.tokens.access_token)) return record.tokens.access_token;
        try {
          await provider.prepare();
          const request = { serverUrl: provider.target, scope: provider.options.scope, fetchFn: provider.request.bind(provider) };
          const result = await auth(provider, request);
          if (result === 'REDIRECT') await auth(provider, { ...request, authorizationCode: await provider.pending.promise });
          const tokens = await provider.tokens();
          if (!tokens?.access_token) {
            throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_OAUTH_TOKENS', message: 'OAuth authorization did not return an access token.' });
          }
          await provider.update({ verifier: undefined, state: undefined });
          return tokens.access_token;
        } finally {
          await provider.stop();
        }
      }
      return provider.context.run(lease, obtain);
    }
    return this.storage.lock(discovery.key, exclusive, { signal: this.options.signal, timeout: this.timeout });
  }

  /**
   * Fetch an upstream MCP request with one bounded refresh/retry.
   * @param {RequestInfo|URL} input - Upstream request.
   * @param {RequestInit} [init] - Caller request options.
   * @returns {Promise<Response>} Unbuffered upstream response.
   */
  async fetch(input, init) {
    const request = new Request(input, init);
    const target = new URL(this.target);
    if (new URL(request.url).origin !== target.origin) {
      throw new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_OAUTH_ORIGIN', message: 'Authenticated requests must use the configured upstream origin.' });
    }
    const retry = request.clone();
    const token = await this.access();
    const source = this.request.bind(this);
    request.headers.set('authorization', `Bearer ${token}`);
    const response = await source(request);
    if (response.status !== 401) return response;
    await response.body?.cancel();
    retry.headers.set('authorization', `Bearer ${await this.access({ rejected: token })}`);
    return source(retry);
  }

  /**
   * Observe upstream request identity while preserving the response stream.
   * @param {RequestInfo|URL} input - Upstream HTTP request.
   * @param {RequestInit} [init] - Fetch request options.
   * @returns {Promise<Response>} Native unbuffered response.
   */
  async request(input, init) {
    const request = new Request(input, init);
    let body;
    if (init?.body instanceof URLSearchParams) body = Object.fromEntries(init.body);
    else if (typeof init?.body === 'string') {
      if (request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) body = Object.fromEntries(new URLSearchParams(init.body));
      else if (request.headers.get('content-type')?.includes('application/json')) body = JSON.parse(init.body);
    }
    const phase = body?.grant_type === 'refresh_token' ? 'refresh' : body?.grant_type ? 'token' : request.method === 'POST' && body?.redirect_uris ? 'registration' : new URL(request.url).pathname === new URL(this.target).pathname ? 'mcp' : 'discovery';
    const response = await (this.options.fetch ?? globalThis.fetch)(request);
    this.options.observe?.({ phase, perspective: 'upstream', url: request.url, method: request.method, headers: request.headers, body, status: response.status, provenance: { role: 'bridge' } });
    return response;
  }

  /** @returns {Promise<object>} Credential diagnostics with no token values or authorization side effects. */
  async status() {
    const discovery = await this.discover();
    const record = await this.storage.get(discovery.key);
    return { target: this.target, issuer: discovery.state.authorizationServerUrl, registered: Boolean(record?.client), expiresAt: record?.expires ?? null, refreshable: Boolean(record?.tokens?.refresh_token), storage: await this.storage.status(discovery.key) };
  }

  /** @returns {Promise<void>} Close the current callback listener. */
  async stop() {
    const listener = this.transport;
    this.transport = undefined;
    if (!listener) return;
    listener.closeAllConnections();
    await new Promise(/**
     * Await callback-listener closure.
     * @param {() => void} resolve Resolve after the listener closes.
     * @returns {void} Starts listener shutdown.
     */
    function closed(resolve) { listener.close(resolve); });
    this.redirect.port = this.port;
  }

  /** @returns {Promise<void>} Cancel interaction and close callback connections. */
  async close() {
    this.pending?.reject(new LayerError({ name: 'forward', method: 'authorize', code: 'ERR_OAUTH_CLOSED', message: 'OAuth authorization was closed.' }));
    await this.stop();
  }
}
