import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { describe, it } from 'node:test';
import express from 'express';
import { Storage } from 'cli-storage';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { issuer } from '../src/issuer.js';

const verifier = 'verifier-for-a-real-sdk-pkce-exchange-with-at-least-43-characters';
const challenge = createHash('sha256').update(verifier).digest('base64url');
const callback = 'http://127.0.0.1:19687/callback';

/**
 * Start an SDK authorization server with private temporary storage.
 * @param {import('node:test').TestContext} t - Current test context.
 * @param {Record<string, unknown>} [options] - Issuer option overrides.
 * @returns {Promise<{ url: string, provider: ReturnType<typeof issuer>, storage: Storage, directory: string, options: Record<string, unknown> }>} Running fixture.
 */
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forward-issuer-'));
  const storage = new Storage({ namespace: 'issuer-test', directory, backend: 'file' });
  const app = express();
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const settings = { url, storage, ...options };
  const provider = issuer(settings);
  app.use(mcpAuthRouter({
    provider,
    issuerUrl: new URL(url),
    resourceServerUrl: new URL(provider.resource),
    scopesSupported: provider.scopes,
    authorizationOptions: { rateLimit: false },
    tokenOptions: { rateLimit: false },
    clientRegistrationOptions: { rateLimit: false },
    revocationOptions: { rateLimit: false },
  }));
  app.get('/mcp', requireBearerAuth({ verifier: provider, expectedResource: provider.resource }), resource);
  /**
   * Return the SDK's authenticated application context.
   * @param {import('express').Request} req - Authenticated request.
   * @param {import('express').Response} res - HTTP response.
   * @returns {void}
   */
  function resource(req, res) {
    res.json({ clientId: req.auth.clientId, scopes: req.auth.scopes, extra: req.auth.extra, resource: req.auth.resource.href });
  }
  t.after(/**
   * Release owned test servers, transports, providers, or temporary records.
   * @returns {Promise<void>} Resolve when owned resource cleanup completes.
   */
  async function cleanup() {
    await new Promise(/**
     * Observe owned listener shutdown.
     * @param {() => void} resolve Resolve after the listener lifecycle event.
     * @param {(error: Error) => void} reject Reject a listener lifecycle error.
     * @returns {void} Complete the asserted operation.
     */
    function close(resolve, reject) {
      server.close(/**
       * Observe owned listener shutdown.
       * @param {(error: Error) => void} error Reject a listener lifecycle error.
       * @returns {void} Complete the asserted operation.
       */
      function closed(error) {
        if (error) reject(error);
        else resolve();
      });
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  });
  return { url, provider, storage, directory, options: settings };
}

/**
 * Register a public OAuth client through the SDK's registration endpoint.
 * @param {Awaited<ReturnType<typeof fixture>>} server - Running issuer fixture.
 * @param {Record<string, unknown>} [metadata] - Standard client metadata overrides.
 * @returns {Promise<import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientInformationFull>} Registered metadata.
 */
async function register(server, metadata = {}) {
  const response = await fetch(`${server.url}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test <assistant>',
      redirect_uris: [callback],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...metadata,
    }),
  });
  assert.equal(response.status, 201, await response.clone().text());
  return response.json();
}

/**
 * Build a standard SDK authorization request.
 * @param {Awaited<ReturnType<typeof fixture>>} server - Running issuer fixture.
 * @param {{client_id: string}} client - Registered client.
 * @param {Record<string, string>} [overrides] - Authorization parameter overrides.
 * @returns {URLSearchParams} Authorization request parameters.
 */
function parameters(server, client, overrides = {}) {
  return new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: callback,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: 'mcp',
    resource: server.provider.resource,
    state: 'state-preserved-by-the-sdk',
    ...overrides,
  });
}

/**
 * Read the consent form without granting access.
 * @param {Awaited<ReturnType<typeof fixture>>} server - Running issuer fixture.
 * @param {{client_id: string}} client - Registered client.
 * @param {Record<string, string>} [overrides] - Authorization parameter overrides.
 * @returns {Promise<{body: URLSearchParams, html: string, response: Response}>} Consent page and its submitted fields.
 */
async function consent(server, client, overrides = {}) {
  const response = await fetch(`${server.url}/authorize?${parameters(server, client, overrides)}`, { redirect: 'manual' });
  const html = await response.text();
  assert.equal(response.status, 200, html);
  const body = new URLSearchParams();
  for (const match of html.matchAll(/<input\b[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g)) {
    body.set(unescape(match[1]), unescape(match[2]));
  }
  assert.ok(body.get('consent'), html);
  return { body, html, response };
}

/**
 * Decode HTML attribute entities used in the consent form.
 * @param {string} value - HTML attribute value.
 * @returns {string} Decoded text.
 */
function unescape(value) {
  return value.replace(/&quot;|&#39;|&lt;|&gt;|&amp;/g, /**
   * Decode one escaped HTML entity from the real consent form.
   * @param {string} match Matched HTML entity.
   * @returns {string} Decoded attribute text.
   */
  function entity(match) {
    return { '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' }[match];
  });
}

/**
 * Submit a consent decision using the SDK's POST authorization endpoint.
 * @param {Awaited<ReturnType<typeof fixture>>} server - Running issuer fixture.
 * @param {URLSearchParams} body - Validated authorization and consent fields.
 * @param {string} [decision] - Explicit resource owner decision.
 * @returns {Promise<URL>} SDK authorization redirect.
 */
async function approve(server, body, decision = 'allow') {
  const request = new URLSearchParams(body);
  request.set('decision', decision);
  const response = await fetch(`${server.url}/authorize`, { method: 'POST', body: request, redirect: 'manual' });
  assert.equal(response.status, 302, await response.text());
  return new URL(response.headers.get('location'));
}

/**
 * Issue an authorization code after an explicit consent decision.
 * @param {Awaited<ReturnType<typeof fixture>>} server - Running issuer fixture.
 * @param {{client_id: string}} client - Registered client.
 * @param {Record<string, string>} [overrides] - Authorization parameter overrides.
 * @returns {Promise<string>} Opaque authorization code.
 */
async function authorize(server, client, overrides = {}) {
  const page = await consent(server, client, overrides);
  const target = await approve(server, page.body);
  assert.equal(target.searchParams.get('state'), overrides.state ?? 'state-preserved-by-the-sdk');
  assert.equal(target.searchParams.get('error'), null, target.href);
  assert.ok(target.searchParams.get('code'));
  return target.searchParams.get('code');
}

/**
 * Exchange a code or refresh token at the real SDK token endpoint.
 * @param {Awaited<ReturnType<typeof fixture>>} server - Running issuer fixture.
 * @param {{client_id: string, client_secret?: string}} client - Registered client.
 * @param {Record<string, string>} body - Standard grant parameters.
 * @returns {Promise<{response: Response, body: Record<string, unknown>}>} HTTP response and JSON body.
 */
async function exchange(server, client, body) {
  const response = await fetch(`${server.url}/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      ...body,
    }),
  });
  return { response, body: await response.json() };
}

/**
 * Redeem a code using a real S256 verifier and its bound redirect/resource.
 * @param {Awaited<ReturnType<typeof fixture>>} server - Running issuer fixture.
 * @param {{client_id: string, client_secret?: string}} client - Registered client.
 * @param {string} code - Issued authorization code.
 * @param {Record<string, string>} [overrides] - Token parameter overrides.
 * @returns {Promise<{response: Response, body: Record<string, unknown>}>} Token response.
 */
async function redeem(server, client, code, overrides = {}) {
  return exchange(server, client, {
    grant_type: 'authorization_code', code, code_verifier: verifier,
    redirect_uri: callback, resource: server.provider.resource, ...overrides,
  });
}

describe('@mcp-layer/forward', /**
 * Register @mcp-layer/forward contract cases.
 * @returns {void} Complete the asserted operation.
 */
function forward() {
  describe('issuer', /**
   * Register issuer contract cases.
   * @returns {void} Complete the asserted operation.
   */
  function provider() {
    it('requires explicit, escaped, single-use consent before issuing a bound SDK bearer token', /**
     * Verify requires explicit, escaped, single-use consent before issuing a bound SDK bearer token.
     * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
     * @returns {Promise<void>} Complete the public API assertions.
     */
    async function consenting(t) {
      const events = [];
      const server = await fixture(t, {
        /**
         * Approve the real issuer request after checking its client and resource.
         * @param {{client: import('@modelcontextprotocol/sdk/shared/auth.js').OAuthClientInformationFull, params: import('@modelcontextprotocol/sdk/server/auth/provider.js').AuthorizationParams}} input Authenticated client and validated authorization request.
         * @returns {Promise<{upstream: string}>} Application grant context for the issued token.
         */
        async grant({ client, params }) {
          assert.equal(client.client_name, 'Test <assistant>');
          assert.deepEqual(params.scopes, ['mcp']);
          assert.equal(params.resource.href, server.provider.resource);
          events.push('grant');
          return { upstream: 'authorized-upstream' };
        },
      });
      const client = await register(server);
      const page = await consent(server, client);
      assert.deepEqual(events, []);
      assert.match(page.html, /Test &lt;assistant&gt;/);
      assert.doesNotMatch(page.html, /Test <assistant>/);
      assert.equal(page.response.headers.get('cache-control'), 'no-store');
      assert.match(page.response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      const target = await approve(server, page.body);
      assert.deepEqual(events, ['grant']);
      const retry = await approve(server, page.body);
      assert.equal(retry.searchParams.get('error'), 'invalid_request');
      const tokens = await redeem(server, client, target.searchParams.get('code'));
      assert.equal(tokens.response.status, 200, JSON.stringify(tokens.body));
      assert.equal(tokens.body.token_type, 'Bearer');
      assert.equal(tokens.body.scope, 'mcp');
      assert.equal(tokens.body.expires_in, 3600);
      const protectedResponse = await fetch(`${server.url}/mcp`, {
        headers: { authorization: `Bearer ${tokens.body.access_token}` },
      });
      assert.equal(protectedResponse.status, 200);
      assert.deepEqual(await protectedResponse.json(), {
        clientId: client.client_id, scopes: ['mcp'],
        extra: { upstream: 'authorized-upstream' }, resource: server.provider.resource,
      });
      const replay = await redeem(server, client, target.searchParams.get('code'));
      assert.equal(replay.response.status, 400);
      assert.equal(replay.body.error, 'invalid_grant');
    });

    it('uses SDK PKCE and redirect validation and binds codes to client, redirect and resource', /**
     * Verify uses SDK PKCE and redirect validation and binds codes to client, redirect and resource.
     * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
     * @returns {Promise<void>} Complete the public API assertions.
     */
    async function binding(t) {
      const server = await fixture(t);
      const client = await register(server);
      const other = await register(server);
      const invalidRedirect = await fetch(`${server.url}/authorize?${parameters(server, client, { redirect_uri: 'https://attacker.example/callback' })}`, { redirect: 'manual' });
      assert.equal(invalidRedirect.status, 400);
      assert.equal((await invalidRedirect.json()).error, 'invalid_request');
      const code = await authorize(server, client);
      for (const [identity, overrides] of [
        [client, { code_verifier: 'x'.repeat(64) }],
        [other, {}],
        [client, { redirect_uri: 'http://127.0.0.1:19688/callback' }],
        [client, { resource: `${server.url}/different` }],
      ]) {
        const result = await redeem(server, identity, code, overrides);
        assert.equal(result.response.status, 400, JSON.stringify(result.body));
        assert.equal(result.body.error, 'invalid_grant');
      }
      const valid = await redeem(server, client, code);
      assert.equal(valid.response.status, 200, JSON.stringify(valid.body));
    });

    it('uses configured clients at runtime and preserves SDK confidential-client authentication', /**
     * Verify uses configured clients at runtime and preserves SDK confidential-client authentication.
     * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
     * @returns {Promise<void>} Complete the public API assertions.
     */
    async function configured(t) {
      const client = {
        client_id: 'preconfigured-client', client_name: 'Configured application',
        client_secret: 'temporary-test-secret', token_endpoint_auth_method: 'client_secret_post',
        redirect_uris: [callback], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      };
      const server = await fixture(t, { clients: [client] });
      assert.deepEqual(await server.provider.clientsStore.getClient(client.client_id), client);
      assert.equal(await server.provider.clientsStore.getClient('unregistered-client'), undefined);
      await assert.rejects(server.provider.clientsStore.registerClient(client), /**
       * Check the standard error returned for duplicate registration.
       * @param {Error & {code: string, package?: string, method?: string, docs?: string}} error Actual public API failure.
       * @returns {boolean} True after all error contract assertions pass.
       */
      function duplicate(error) {
        assert.equal(error.code, 'invalid_client_metadata');
        assert.equal(error.package, '@mcp-layer/forward');
        return true;
      });
      const code = await authorize(server, client);
      const denied = await redeem(server, { ...client, client_secret: 'incorrect-secret' }, code);
      assert.equal(denied.response.status, 400);
      assert.equal(denied.body.error, 'invalid_client');
      const valid = await redeem(server, client, code);
      assert.equal(valid.response.status, 200, JSON.stringify(valid.body));
      const dynamic = await register(server);
      await assert.rejects(server.provider.clientsStore.registerClient(dynamic), /**
       * Check the standard error returned for duplicate registration.
       * @param {Error & {code: string, package?: string, method?: string, docs?: string}} error Actual public API failure.
       * @returns {boolean} True after all error contract assertions pass.
       */
      function duplicate(error) {
        assert.equal(error.code, 'invalid_client_metadata');
        return true;
      });
    });

    it('rejects unsupported scopes/resources and altered or denied consent', /**
     * Verify rejects unsupported scopes/resources and altered or denied consent.
     * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
     * @returns {Promise<void>} Complete the public API assertions.
     */
    async function rejecting(t) {
      const server = await fixture(t);
      const client = await register(server);
      for (const [overrides, expected] of [
        [{ scope: 'admin' }, 'invalid_scope'],
        [{ resource: `${server.url}/other` }, 'invalid_target'],
      ]) {
        const response = await fetch(`${server.url}/authorize?${parameters(server, client, overrides)}`, { redirect: 'manual' });
        assert.equal(response.status, 302);
        assert.equal(new URL(response.headers.get('location')).searchParams.get('error'), expected);
      }
      const changed = await consent(server, client);
      changed.body.set('state', 'changed-after-consent');
      const rejected = await approve(server, changed.body);
      assert.equal(rejected.searchParams.get('error'), 'invalid_request');
      const page = await consent(server, client);
      const denied = await approve(server, page.body, 'deny');
      assert.equal(denied.searchParams.get('error'), 'access_denied');
      assert.equal(denied.searchParams.get('code'), null);
    });

    it('rotates refresh tokens atomically, narrows scope and revokes the whole associated grant', /**
     * Verify rotates refresh tokens atomically, narrows scope and revokes the whole associated grant.
     * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
     * @returns {Promise<void>} Complete the public API assertions.
     */
    async function refreshing(t) {
      const server = await fixture(t, { scopes: ['mcp', 'read'] });
      const client = await register(server);
      const other = await register(server);
      const code = await authorize(server, client, { scope: 'mcp read' });
      const tokens = await redeem(server, client, code);
      assert.equal(tokens.response.status, 200, JSON.stringify(tokens.body));
      const unauthorized = await fetch(`${server.url}/revoke`, {
        method: 'POST', body: new URLSearchParams({ client_id: other.client_id, token: tokens.body.access_token }),
      });
      assert.equal(unauthorized.status, 200);
      assert.equal((await server.provider.verifyAccessToken(tokens.body.access_token)).clientId, client.client_id);
      const request = { grant_type: 'refresh_token', refresh_token: tokens.body.refresh_token, resource: server.provider.resource };
      const wrong = await exchange(server, other, request);
      assert.equal(wrong.body.error, 'invalid_grant');
      const expanded = await exchange(server, client, { ...request, scope: 'admin' });
      assert.equal(expanded.body.error, 'invalid_scope');
      const foreign = await exchange(server, client, { ...request, resource: `${server.url}/other` });
      assert.equal(foreign.body.error, 'invalid_grant');
      const results = await Promise.all([
        exchange(server, client, { ...request, scope: 'read' }),
        exchange(server, client, { ...request, scope: 'read' }),
      ]);
      const winner = results.find(/**
       * Select a successful real exchange.
       * @param {{response: Response}} result Actual exchange result.
       * @returns {boolean} Whether the actual exchange has the expected outcome.
       */
      function success(result) { return result.response.status === 200; });
      const loser = results.find(/**
       * Select a rejected real exchange.
       * @param {{response: Response}} result Actual exchange result.
       * @returns {boolean} Whether the actual exchange has the expected outcome.
       */
      function failure(result) { return result.response.status === 400; });
      assert.ok(winner);
      assert.equal(loser?.body.error, 'invalid_grant');
      assert.equal(winner.body.scope, 'read');
      assert.notEqual(winner.body.refresh_token, tokens.body.refresh_token);
      const revocation = await fetch(`${server.url}/revoke`, {
        method: 'POST', body: new URLSearchParams({ client_id: client.client_id, token: winner.body.access_token, token_type_hint: 'access_token' }),
      });
      assert.equal(revocation.status, 200);
      for (const token of [tokens.body.access_token, winner.body.access_token]) {
        const response = await fetch(`${server.url}/mcp`, { headers: { authorization: `Bearer ${token}` } });
        assert.equal(response.status, 401);
        assert.match(response.headers.get('www-authenticate'), /invalid_token/);
      }
      const revoked = await exchange(server, client, { ...request, refresh_token: winner.body.refresh_token });
      assert.equal(revoked.body.error, 'invalid_grant');
    });

    it('persists registration and tokens through fresh Storage/provider instances without retaining plaintext token indices', /**
     * Verify persists registration and tokens through fresh Storage/provider instances without retaining plaintext token indices.
     * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
     * @returns {Promise<void>} Complete the public API assertions.
     */
    async function persistence(t) {
      const observations = [];
      const server = await fixture(t, { observe: /**
       * Retain actual credential-free boundary observations for assertions.
       * @param {Record<string, any>} event Actual operation observation.
       * @returns {void} Append the observation to test evidence.
       */
      function observe(event) { observations.push(event); } });
      const client = await register(server);
      const code = await authorize(server, client);
      const tokens = await redeem(server, client, code);
      const storage = new Storage({ namespace: 'issuer-test', directory: server.directory, backend: 'file' });
      const restarted = issuer({ ...server.options, storage });
      assert.deepEqual(await restarted.clientsStore.getClient(client.client_id), client);
      const auth = await restarted.verifyAccessToken(tokens.body.access_token);
      assert.equal(auth.clientId, client.client_id);
      assert.equal(auth.resource.href, server.provider.resource);
      const snapshot = await storage.get(`forward:issuer:${createHash('sha256').update(`${restarted.url}\0${restarted.resource}`).digest('hex')}`);
      const serialized = JSON.stringify(snapshot);
      assert.ok(snapshot);
      assert.ok(!serialized.includes(code));
      assert.ok(!serialized.includes(tokens.body.access_token));
      assert.ok(!serialized.includes(tokens.body.refresh_token));
      assert.ok(observations.length > 0);
      const observed = JSON.stringify(observations);
      for (const token of [code, tokens.body.access_token, tokens.body.refresh_token]) assert.ok(!observed.includes(token));
      assert.ok(observations.every(/**
       * Select original downstream evidence.
       * @param {Record<string, any>} event Actual boundary observation.
       * @returns {boolean} Whether the observation matches.
       */
      function provenance(event) { return event.perspective === 'downstream'; }));
    });

    it('allows only one refresh redemption across independent Node processes sharing the injected storage', /**
     * Verify allows only one refresh redemption across independent Node processes sharing the injected storage.
     * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
     * @returns {Promise<void>} Complete the public API assertions.
     */
    async function processes(t) {
      const server = await fixture(t);
      const client = await register(server);
      const code = await authorize(server, client);
      const tokens = await redeem(server, client, code);
      const payload = {
        directory: server.directory, url: server.provider.url,
        resource: server.provider.resource, clientId: client.client_id,
        token: tokens.body.refresh_token,
      };
      /**
       * Redeem through a real provider in a fresh Node process.
       * @returns {Promise<Record<string, unknown>>} Public provider result or documented OAuth failure.
       */
      async function child() {
        const worker = fork(new URL('./fixtures/issuer-process.mjs', import.meta.url), {
          stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
        });
        t.after(/**
         * Terminate the owned subprocess.
         * @returns {void} Initiate owned resource cleanup.
         */
        function cleanup() { worker.kill(); });
        const delivered = once(worker, 'message');
        worker.send(payload);
        const [message] = await delivered;
        return message;
      }
      const results = await Promise.all([child(), child()]);
      const winner = results.find(/**
       * Select a successful real exchange.
       * @param {PromiseSettledResult<unknown>} result Actual exchange result.
       * @returns {boolean} Whether the actual exchange has the expected outcome.
       */
      function success(result) { return result.status === 'fulfilled'; });
      const loser = results.find(/**
       * Select a rejected real exchange.
       * @param {PromiseSettledResult<unknown>} result Actual exchange result.
       * @returns {boolean} Whether the actual exchange has the expected outcome.
       */
      function failure(result) { return result.status === 'rejected'; });
      assert.ok(winner);
      assert.equal(loser?.code, 'invalid_grant');
      assert.equal(loser?.package, '@mcp-layer/forward');
      const verified = await server.provider.verifyAccessToken(winner.access_token);
      assert.equal(verified.clientId, client.client_id);
      assert.equal(verified.resource.href, server.provider.resource);
    });

    it('expires consent, authorization codes, access and refresh tokens using configured lifetimes', /**
     * Verify expires consent, authorization codes, access and refresh tokens using configured lifetimes.
     * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
     * @returns {Promise<void>} Complete the public API assertions.
     */
    async function expiry(t) {
      const short = await fixture(t, { codeTtl: 2, accessTtl: 0.2, refreshTtl: 0.2 });
      const client = await register(short);
      const page = await consent(short, client);
      await delay(2050);
      const expired = await approve(short, page.body);
      assert.equal(expired.searchParams.get('error'), 'invalid_request');
      const code = await authorize(short, client);
      await delay(2050);
      const invalid = await redeem(short, client, code);
      assert.equal(invalid.body.error, 'invalid_grant');
      const fresh = await authorize(short, client);
      const tokens = await redeem(short, client, fresh);
      assert.equal(tokens.response.status, 200, JSON.stringify(tokens.body));
      await delay(300);
      const response = await fetch(`${short.url}/mcp`, { headers: { authorization: `Bearer ${tokens.body.access_token}` } });
      assert.equal(response.status, 401);
      const refresh = await exchange(short, client, { grant_type: 'refresh_token', refresh_token: tokens.body.refresh_token });
      assert.equal(refresh.body.error, 'invalid_grant');
    });

    it('rejects missing storage and invalid options with documented LayerErrors', /**
     * Verify rejects missing storage and invalid options with documented LayerErrors.
     * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
     * @returns {Promise<void>} Complete the public API assertions.
     */
    async function configuration(t) {
      const server = await fixture(t);
      for (const options of [
        { url: 'http://127.0.0.1:8787' },
        { url: 'not-a-url', storage: {} },
        { url: server.url, storage: server.storage, accessTtl: 0 },
        { url: server.url, storage: server.storage, scopes: 'mcp' },
        { url: server.url, storage: server.storage, scopes: [''] },
        { url: server.url, storage: server.storage, resource: `${server.url}/mcp#fragment` },
      ]) {
        assert.throws(/**
         * Exercise rejection of the current invalid public option.
         * @returns {void} Throw the expected validation or process error.
         */
        function invalid() { issuer(options); }, /**
         * Check public error metadata and documentation references.
         * @param {Error & {code: string, package?: string, method?: string, docs?: string}} error Actual public API failure.
         * @returns {boolean} True after all error contract assertions pass.
         */
        function documented(error) {
          assert.equal(error.name, 'LayerError');
          assert.equal(error.package, '@mcp-layer/forward');
          assert.equal(error.method, 'issuer');
          assert.ok(error.reference);
          assert.match(error.docs, /packages\/forward\/README.md#error-/);
          assert.ok(error.code);
          return true;
        });
      }
    });
  });
});
