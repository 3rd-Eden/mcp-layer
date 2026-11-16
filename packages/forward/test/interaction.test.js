import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { Storage } from 'cli-storage';
import { createServer } from 'node:http';
import { authorize } from '../src/index.js';
import { browser, service } from './fixtures/oauth-server.mjs';

/** Start a local endpoint that accepts but never completes OAuth discovery requests.
 * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
 * @returns {Promise<{target:string,requested:Promise<void>}>} Stalled resource and actual request signal.
 */
async function stalled(t) {
  let request;
  const requested = new Promise(/** @param {() => void} resolve Resolve when discovery reaches the local server. @returns {void} */
  function wait(resolve) { request = resolve; });
  const server = createServer(/** @param {import('node:http').IncomingMessage} req Incoming request. @param {import('node:http').ServerResponse} res Response. @returns {void} Keep the endpoint pending until the client aborts. */
  function hold(req, res) { request?.(); });
  await new Promise(/** @param {() => void} resolve Resolve after listening. @returns {void} */
  function listen(resolve) { server.listen(0, '127.0.0.1', resolve); });
  t.after(/** @returns {Promise<void>} Close pending connections and the HTTP server. */
  function close() { server.closeAllConnections(); return new Promise(/** @param {() => void} resolve Resolve after closing. @returns {void} */
  function stop(resolve) { server.close(resolve); }); });
  return { target: `http://127.0.0.1:${server.address().port}/mcp`, requested };
}

/** Start a real local endpoint that sends headers and then leaves its JSON body open.
 * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
 * @returns {Promise<{target:string,headers:Promise<void>}>} Endpoint and response-header signal.
 */
async function openBody(t) {
  let ready;
  const headers = new Promise(/** @param {() => void} resolve Resolve after response headers are sent. @returns {void} */
  function waiting(resolve) { ready = resolve; });
  const server = createServer(/** @param {import('node:http').IncomingMessage} req Incoming request. @param {import('node:http').ServerResponse} res Response stream. @returns {void} Send headers and hold the body open. */
  function hold(req, res) { res.writeHead(200, { 'content-type': 'application/json' }); res.flushHeaders(); ready?.(); });
  await new Promise(/** @param {() => void} resolve Resolve after listening. @returns {void} */
  function listen(resolve) { server.listen(0, '127.0.0.1', resolve); });
  t.after(/** @returns {Promise<void>} Close open response connections. */
  function close() { server.closeAllConnections(); return new Promise(/** @param {() => void} resolve Resolve after closing. @returns {void} */
  function stop(resolve) { server.close(resolve); }); });
  const target = `http://127.0.0.1:${server.address().port}/mcp`;
  return { target, headers };
}

/** Register actual browser/callback failure and recovery scenarios. @returns {void} */
function suite() {
  it('rejects invalid callback URLs, ports and interaction deadlines before opening sockets', /**
   * Verify rejects invalid callback URLs, ports and interaction deadlines before opening sockets.
   * @returns {void} Complete the asserted operation.
   */
  function options() {
    const storage = new Storage({ namespace: 'forward-invalid-options' });
    for (const callbackPort of [-1, 65536, NaN, 1.5]) assert.throws(/**
     * Exercise rejection of the current invalid public option.
     * @returns {void} Throw the expected validation or process error.
     */
    function invalid() { authorize({ target: 'http://127.0.0.1/mcp', storage, callbackPort }); }, { code: 'ERR_CALLBACK' });
    for (const authTimeout of [0, -1, Infinity]) assert.throws(/**
     * Exercise rejection of the current invalid public option.
     * @returns {void} Throw the expected validation or process error.
     */
    function invalid() { authorize({ target: 'http://127.0.0.1/mcp', storage, authTimeout }); }, { code: 'ERR_OAUTH_OPTIONS' });
    assert.throws(/**
     * Exercise rejection of the current invalid public option.
     * @returns {void} Throw the expected validation or process error.
     */
    function invalid() { authorize({ target: 'http://127.0.0.1/mcp', storage, redirectUrl: 'invalid' }); }, { code: 'ERR_CALLBACK' });
  });

  it('rejects a preregistered client with an incompatible callback before opening consent',
    /**
     * Check an actual SDK registration against the runtime callback host and path.
     * @param {import('node:test').TestContext} t Real service cleanup lifecycle.
     * @returns {Promise<void>} An actionable registration constraint error is reported.
     */
    async function registration(t) {
      const upstream = await service(t);
      const response = await fetch(new URL('/register', upstream.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: 'Callback binding test',
          redirect_uris: ['http://localhost:12345/callback'],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
        }),
      });
      assert.equal(response.status, 201);
      const provider = authorize({
        target: upstream.url,
        storage: upstream.storage,
        clientInformation: { ...await response.json(), issuer: new URL('/', upstream.url).href },
        redirectUrl: 'http://127.0.0.1:0/callback',
        open: browser,
      });
      t.after(provider.close.bind(provider));
      await assert.rejects(provider.access(), { code: 'ERR_OAUTH_REGISTRATION', method: 'authorize' });
    });

  it('rejects confidential preregistrations without runtime secrets before consent', /**
   * Verify direct SDK provider use fails actionably before opening an authorization URL.
   * @param {import('node:test').TestContext} t Real service cleanup lifecycle.
   * @returns {Promise<void>} Registration incompatibility is reported.
   */
  async function credentials(t) {
    const upstream = await service(t);
    for (const method of ['client_secret_basic', 'client_secret_post']) {
      const provider = authorize({ target: upstream.url, storage: upstream.storage, clientInformation: { client_id: 'issuer-client', token_endpoint_auth_method: method, issuer: new URL('/', upstream.url).href } });
      t.after(/** @returns {Promise<void>} Close provider callback resources. */
      function close() { return provider.close(); });
      await assert.rejects(provider.clientInformation(), { code: 'ERR_OAUTH_REGISTRATION', method: 'authorize' });
    }
    const supported = authorize({ target: upstream.url, storage: upstream.storage, clientInformation: { client_id: 'issuer-client', client_secret: 'runtime-secret', token_endpoint_auth_method: 'client_secret_basic', issuer: new URL('/', upstream.url).href } });
    t.after(/** @returns {Promise<void>} Close provider callback resources. */
    function close() { return supported.close(); });
    assert.equal((await supported.clientInformation()).client_secret, 'runtime-secret');
  });

  it('retains official protected-resource scopes with an explicit authorization issuer', /**
   * Verify SDK PRM discovery remains bound to its real resource while the caller selects its issuer.
   * @param {import('node:test').TestContext} t Real service cleanup lifecycle.
   * @returns {Promise<void>} Discovery retains actual resource metadata.
   */
  async function metadata(t) {
    const canonical = 'https://api.example.test/catalog';
    const upstream = await service(t, { resource: canonical, scopes: ['records:read'] });
    const provider = authorize({ target: upstream.url, issuer: new URL('/', upstream.url).href, storage: upstream.storage });
    t.after(/** @returns {Promise<void>} Close provider callback resources. */
    function close() { return provider.close(); });
    const discovery = await provider.discover();
    assert.equal(discovery.state.authorizationServerUrl, new URL('/', upstream.url).href);
    assert.equal(discovery.state.resourceMetadata.resource, canonical);
    assert.deepEqual(discovery.state.resourceMetadata.scopes_supported, ['records:read']);
  });

  it('bounds stalled OAuth fetches, caller cancellation, and provider shutdown', /**
   * Verify the configured auth deadline and owned shutdown cancel real stalled local HTTP requests.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Every pending discovery operation settles promptly.
   */
  async function network(t) {
    const storage = new Storage({ namespace: 'forward-network-timeout' });
    const timedTarget = await stalled(t);
    const timed = authorize({ target: timedTarget.target, storage, authTimeout: 40 });
    t.after(/** @returns {Promise<void>} Close timeout provider. */
    function close() { return timed.close(); });
    await assert.rejects(timed.discover(), { code: 'ERR_OAUTH_TIMEOUT' });

    const signal = new AbortController();
    const cancelledTarget = await stalled(t);
    const cancelled = authorize({ target: cancelledTarget.target, storage, signal: signal.signal });
    t.after(/** @returns {Promise<void>} Close cancelled provider. */
    function close() { return cancelled.close(); });
    const pending = cancelled.discover();
    await cancelledTarget.requested;
    signal.abort();
    await assert.rejects(pending);

    const closingTarget = await stalled(t);
    const closing = authorize({ target: closingTarget.target, storage });
    const blocked = closing.discover();
    await closingTarget.requested;
    await closing.close();
    await assert.rejects(blocked, { code: 'ERR_OAUTH_CLOSED' });
  });

  it('bounds OAuth discovery and SDK token response bodies after headers arrive', /**
   * Verify authTimeout remains active while SDK discovery and token JSON bodies are read.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Both real local OAuth response bodies time out promptly.
   */
  async function bodies(t) {
    const timers = new Set();
    const server = createServer(/** @param {import('node:http').IncomingMessage} req Incoming discovery request. @param {import('node:http').ServerResponse} res Metadata response. @returns {void} Send headers and delay its JSON body. */
    function discovery(req, res) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.flushHeaders();
      const timer = setTimeout(/** @returns {void} Complete the delayed local metadata response. */
      function respond() {
        const origin = `http://127.0.0.1:${server.address().port}`;
        const metadata = req.url?.includes('oauth-protected-resource')
          ? { resource: `${origin}/mcp`, authorization_servers: [origin], scopes_supported: ['read'] }
          : { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] };
        res.end(JSON.stringify(metadata));
        timers.delete(timer);
      }, 500);
      timers.add(timer);
      res.once('close', /** @returns {void} Stop an unused delayed response. */
      function disconnected() { clearTimeout(timer); timers.delete(timer); });
    });
    await new Promise(/** @param {() => void} resolve Resolve after listening. @returns {void} */
    function listen(resolve) { server.listen(0, '127.0.0.1', resolve); });
    t.after(/** @returns {Promise<void>} Close discovery endpoint and pending timers. */
    function close() { for (const timer of timers) clearTimeout(timer); server.closeAllConnections(); return new Promise(/** @param {() => void} resolve Resolve after closing. @returns {void} */
    function stop(resolve) { server.close(resolve); }); });
    const discoveryStore = new Storage({ namespace: 'forward-delayed-discovery' });
    const discoveryProvider = authorize({ target: `http://127.0.0.1:${server.address().port}/mcp`, storage: discoveryStore, issuer: `http://127.0.0.1:${server.address().port}`, authTimeout: 80 });
    t.after(/** @returns {Promise<void>} Close discovery provider. */
    function close() { return discoveryProvider.close(); });
    await assert.rejects(discoveryProvider.discover(), { code: 'ERR_OAUTH_TIMEOUT' });

    const upstream = await service(t, { delayTokenBodyMs: 500 });
    const tokenProvider = authorize({ target: upstream.url, storage: upstream.storage, open: browser, authTimeout: 100 });
    t.after(/** @returns {Promise<void>} Close token provider. */
    function close() { return tokenProvider.close(); });
    const token = tokenProvider.access();
    await upstream.tokenBodyStarted;
    await assert.rejects(token, { code: 'ERR_OAUTH_TIMEOUT' });

    const abortTarget = await openBody(t);
    const signal = new AbortController();
    const abortProvider = authorize({ target: abortTarget.target, storage: discoveryStore, signal: signal.signal });
    t.after(/** @returns {Promise<void>} Close abort provider. */
    function close() { return abortProvider.close(); });
    const aborted = abortProvider.discover();
    await abortTarget.headers;
    signal.abort();
    await assert.rejects(aborted);

    const closeTarget = await openBody(t);
    const closeProvider = authorize({ target: closeTarget.target, storage: discoveryStore });
    const closing = closeProvider.discover();
    await closeTarget.headers;
    await closeProvider.close();
    await assert.rejects(closing, { code: 'ERR_OAUTH_CLOSED' });
  });

  it('closes an active loopback callback when the browser opener remains pending', /**
   * Verify provider shutdown settles authorization and releases an already-bound callback listener.
   * @param {import('node:test').TestContext} t Real SDK issuer and listener cleanup lifecycle.
   * @returns {Promise<void>} Pending browser work rejects and its loopback port closes.
   */
  async function closeInteraction(t) {
    const upstream = await service(t);
    let opened;
    const started = new Promise(/** @param {() => void} resolve Resolve after the real consent page is fetched. @returns {void} */
    function waiting(resolve) { opened = resolve; });
    /** Fetch the real SDK consent page, then remain pending like an interactive browser session.
     * @param {URL} url SDK authorization URL.
     * @returns {Promise<void>} Browser lifecycle held until provider shutdown.
     */
    async function hold(url) {
      const page = await fetch(url);
      assert.equal(page.status, 200);
      await page.body?.cancel();
      opened();
      await new Promise(/** @returns {void} Keep the browser session pending until shutdown. */
      function wait() {});
    }
    const provider = authorize({ target: upstream.url, storage: upstream.storage, open: hold, authTimeout: 5000 });
    t.after(/** @returns {Promise<void>} Close provider resources. */
    function close() { return provider.close(); });
    const pending = provider.access();
    await started;
    const callback = new URL(provider.redirectUrl);
    assert.notEqual(callback.port, '0');
    await provider.close();
    await assert.rejects(pending, { code: 'ERR_OAUTH_CLOSED' });
    assert.equal(provider.transport, undefined);
    await assert.rejects(fetch(callback));
  });

  it('does not open consent when close wins after callback preparation', /**
   * Verify a prepared SDK callback cannot begin browser interaction after close wins the await boundary.
   * @param {import('node:test').TestContext} t Real issuer and callback cleanup lifecycle.
   * @returns {Promise<void>} Closed authorization never opens the real consent page.
   */
  async function closeBeforeOpen(t) {
    const upstream = await service(t);
    let opened = false;
    /** Submit consent through the real local SDK issuer. @param {URL} url Issuer authorization URL. @returns {Promise<void>} Complete consent. */
    async function open(url) { opened = true; await browser(url); }
    const provider = authorize({ target: upstream.url, storage: upstream.storage, open, authTimeout: 100 });
    t.after(/** @returns {Promise<void>} Close provider resources. */
    function close() { return provider.close(); });
    await provider.prepare();
    await provider.access();
    opened = false;
    await provider.prepare();
    const client = await provider.clientInformation();
    const verifier = 'close-before-open-verifier';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = 'close-before-open-state';
    const authorization = new URL('/authorize', new URL('/', upstream.url));
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: provider.redirectUrl,
      scope: 'mcp',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: upstream.url,
    }).toString();
    const interaction = provider.redirectToAuthorization(authorization);
    await provider.close();
    await assert.rejects(interaction, { code: 'ERR_OAUTH_CLOSED' });
    assert.equal(opened, false);
  });

  it('reports real OAuth consent denial without waiting for the interaction deadline', /**
   * Verify reports real OAuth consent denial without waiting for the interaction deadline.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function denied(t) {
    const upstream = await service(t);
    /** Deny the actual issuer form. @param {URL} url - Login URL. @returns {Promise<void>} */
    async function open(url) { await browser(url, 'deny'); }
    const provider = authorize({ target: upstream.url, storage: upstream.storage, open, authTimeout: 5000 });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return provider.close(); });
    await assert.rejects(provider.access(), { code: 'ERR_OAUTH_DENIED' });
  });

  it('times out an unconfirmed real consent page and permits a later clean login', /**
   * Verify times out an unconfirmed real consent page and permits a later clean login.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function deadline(t) {
    const upstream = await service(t);
    /** Open the real page without submitting consent. @param {URL} url - Login URL. @returns {Promise<void>} */
    async function open(url) { const page = await fetch(url); assert.equal(page.status, 200); await page.body.cancel(); }
    const pending = authorize({ target: upstream.url, storage: upstream.storage, open, authTimeout: 100 });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return pending.close(); });
    await assert.rejects(pending.access(), { code: 'ERR_OAUTH_TIMEOUT' });
    const resumed = authorize({ target: upstream.url, storage: upstream.storage, open: browser });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return resumed.close(); });
    assert.equal(typeof await resumed.access(), 'string');
  });
}

describe('@mcp-layer/forward interaction', suite);
