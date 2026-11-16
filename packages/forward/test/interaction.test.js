import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Storage } from 'cli-storage';
import { authorize } from '../src/index.js';
import { browser, service } from './fixtures/oauth-server.mjs';

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
