import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { apply, capture, derive, get, match } from '../src/index.js';
import { listen, read } from './fixtures/http.js';
import { service } from './fixtures/provider.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/capture.json', import.meta.url), 'utf8'));

/**
 * Preserve a private-field-backed public OAuth client behind an immutable shell.
 */
class BoundProvider {
  #provider;

  /** @param {import('@mcp-layer/forward').Authorization} provider - Real cli-storage-backed OAuth client. */
  constructor(provider) { this.#provider = provider; }
  /** @returns {object} Actual SDK client metadata. */
  get clientMetadata() { return this.#provider.clientMetadata; }
  /** @returns {string} Actual loopback callback. */
  get redirectUrl() { return this.#provider.redirectUrl; }
  /** @returns {Promise<object|undefined>} Persisted registration. */
  clientInformation() { return this.#provider.clientInformation(); }
  /** @param {object} value - Registration to persist. @returns {Promise<void>} Save completion. */
  saveClientInformation(value) { return this.#provider.saveClientInformation(value); }
  /** @returns {Promise<object|undefined>} Persisted SDK tokens. */
  tokens() { return this.#provider.tokens(); }
  /** @param {object} value - SDK-issued tokens. @returns {Promise<void>} Save completion. */
  saveTokens(value) { return this.#provider.saveTokens(value); }
  /** @returns {Promise<string>} Transaction state. */
  state() { return this.#provider.state(); }
  /** @param {string} value - SDK PKCE verifier. @returns {Promise<void>} Save completion. */
  saveCodeVerifier(value) { return this.#provider.saveCodeVerifier(value); }
  /** @returns {Promise<string>} Stored PKCE verifier. */
  codeVerifier() { return this.#provider.codeVerifier(); }
  /** @param {URL} url - Authorization URL. @returns {Promise<void>} Redirect handling completion. */
  redirectToAuthorization(url) { return this.#provider.redirectToAuthorization(url); }
  /** @param {'all'|'client'|'tokens'|'verifier'|'discovery'} scope - Credential category. @returns {Promise<void>} Invalidation completion. */
  invalidateCredentials(scope) { return this.#provider.invalidateCredentials(scope); }
  /** @param {string|URL} server - MCP server URL. @param {string} [resource] - Explicit resource URL. @returns {Promise<URL>} Selected resource URL. */
  validateResourceURL(server, resource) { return this.#provider.validateResourceURL(server, resource); }
}

/**
 * Derive a synthetic profile through the public recorder API.
 * @returns {import('../src/index.js').Profile} Synthetic evidence-backed profile.
 */
function recorded() {
  const recorder = capture(fixture.options);
  for (const observation of fixture.observations) recorder.observe(observation);
  return derive(recorder.finish());
}

/** @returns {void} Register real HTTP, SDK, and provider scenarios. */
function suite() {
  /**
   * Verify Request bodies, headers, response streams, and abort signals over real HTTP.
   * @returns {Promise<void>} Completes after endpoint teardown.
   */
  async function http() {
    /**
     * Echo the real request or emit an unfinished event stream.
     * @param {import('node:http').IncomingMessage} request - HTTP request.
     * @param {import('node:http').ServerResponse} response - HTTP response.
     * @returns {Promise<void>} Resolves after the response starts or completes.
     */
    async function handler(request, response) {
      if (request.url === '/stream') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: first\n\n');
        return;
      }
      const body = await read(request);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ headers: request.headers, body, method: request.method }));
    }
    const server = await listen(handler);
    try {
      const runtime = apply(recorded(), { headers: { 'x-public-flavor': 'runtime-default' }, fetch: globalThis.fetch });
      const controller = new AbortController();
      const original = new Request(`${server.url}/echo`, {
        method: 'POST', body: 'unchanged request body', signal: controller.signal,
        headers: { 'user-agent': 'request-identity', authorization: 'Bearer runtime-auth', 'mcp-session-id': 'runtime-session', 'mcp-protocol-version': '2025-11-25', 'content-type': 'application/custom' },
      });
      const response = await runtime.fetch(original, { headers: { 'x-public-flavor': 'per-request' } });
      const result = await response.json();
      assert.equal(result.headers['user-agent'], 'request-identity');
      assert.equal(result.headers['x-public-flavor'], 'per-request');
      assert.equal(result.headers.authorization, 'Bearer runtime-auth');
      assert.equal(result.headers['mcp-session-id'], 'runtime-session');
      assert.equal(result.headers['mcp-protocol-version'], '2025-11-25');
      assert.equal(result.headers['content-type'], 'application/custom');
      assert.equal(result.body, 'unchanged request body');
      assert.equal(result.method, 'POST');
      runtime.headers.set('x-public-flavor', 'mutated-default');
      const changed = await runtime.fetch(`${server.url}/echo`);
      const changedResult = await changed.json();
      assert.equal(changedResult.headers['x-public-flavor'], 'mutated-default');
      const streamed = await runtime.fetch(`${server.url}/stream`);
      assert.equal(streamed.bodyUsed, false);
      const reader = streamed.body.getReader();
      const chunk = await reader.read();
      assert.equal(new TextDecoder().decode(chunk.value), 'data: first\n\n');
      await reader.cancel();
      controller.abort();
      await assert.rejects(runtime.fetch(new Request(`${server.url}/echo`, { signal: controller.signal })), { name: 'AbortError' });
    } finally {
      await server.close();
    }
  }

  /**
   * Connect an official SDK client to an official SDK server using applied identity.
   * @returns {Promise<void>} Completes after the SDK connection and loopback server close.
   */
  async function sdk() {
    const profile = get('claude-code');
    const recorder = capture({ capturedAt: fixture.options.capturedAt });
    const observations = [];
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true });
    const server = new Server({ name: 'profiles-integration', version: '1.0.0' }, { capabilities: { tools: {} } });
    /** @returns {Promise<{tools: []}>} Real SDK tools/list response. */
    async function tools() { return { tools: [] }; }
    server.setRequestHandler(ListToolsRequestSchema, tools);
    await server.connect(transport);
    /**
     * Pass real HTTP messages to the official SDK server transport.
     * @param {import('node:http').IncomingMessage} request - HTTP request.
     * @param {import('node:http').ServerResponse} response - HTTP response.
     * @returns {Promise<void>} SDK request completion.
     */
    async function handler(request, response) {
      const text = await read(request);
      const message = text ? JSON.parse(text) : undefined;
      const observation = { phase: 'mcp', perspective: 'downstream', headers: request.headers, message, method: request.method, provenance: { role: 'client' } };
      observations.push(observation);
      recorder.observe(observation);
      await transport.handleRequest(request, response, message);
    }
    const endpoint = await listen(handler);
    const runtime = apply(profile);
    const client = new Client(runtime.info, { capabilities: {} });
    const connection = new StreamableHTTPClientTransport(new URL(`${endpoint.url}/mcp`), { fetch: runtime.fetch, requestInit: { headers: { authorization: 'Bearer runtime-sdk' } } });
    try {
      await client.connect(connection);
      assert.deepEqual(await client.listTools(), { tools: [] });
      assert.deepEqual(server.getClientVersion(), profile.mcp.clientInfo);
      const initialized = observations.find(
        /**
         * Find the actual SDK initialize request.
         * @param {any} value - Recorded real HTTP observation.
         * @returns {boolean} Whether this is initialize.
         */
        function initialize(value) { return value.message?.method === 'initialize'; });
      assert.equal(initialized.headers['user-agent'], profile.http.headers['user-agent']);
      assert.equal(match(initialized, { profiles: [profile] }).status, 'matched');
      const toolsRequest = observations.find(
        /**
         * Find the actual SDK tools request.
         * @param {any} value - Recorded real HTTP observation.
         * @returns {boolean} Whether this is tools/list.
         */
        function call(value) { return value.message?.method === 'tools/list'; });
      assert.equal(toolsRequest.headers.authorization, 'Bearer runtime-sdk');
      assert.equal(toolsRequest.headers['mcp-session-id'], transport.sessionId);
      assert.ok(toolsRequest.headers['mcp-protocol-version']);
      assert.doesNotMatch(JSON.stringify(recorder.finish()), /runtime-sdk/);
    } finally {
      await client.close();
      await server.close();
      await endpoint.close();
    }
  }

  /**
   * Verify provider delegation and runtime precedence with real storage.
   * @returns {Promise<void>} Resolves after all runtime storage operations complete.
   */
  async function provider(t) {
    const profile = recorded();
    const fixture = await service(t);
    const store = fixture.provider;
    const runtime = apply(profile, { authProvider: store, issuer: fixture.url }).authProvider;
    assert.equal(runtime.clientMetadata.client_name, 'Fixture Desktop');
    assert.deepEqual(runtime.clientMetadata.redirect_uris, [store.redirectUrl]);
    assert.equal(await runtime.clientInformation(), undefined);
    assert.equal(await apply(profile, { authProvider: store }).authProvider.clientInformation(), undefined);
    assert.equal(await apply(profile, { authProvider: store, issuer: 'http://127.0.0.1:1' }).authProvider.clientInformation(), undefined);
    const access = await store.access();
    assert.equal((await runtime.clientInformation()).client_id, (await store.clientInformation()).client_id);
    assert.equal((await runtime.tokens()).access_token, access);
    await runtime.saveCodeVerifier('contract-verifier');
    assert.equal(await runtime.codeVerifier(), 'contract-verifier');
    assert.match(await runtime.state(), /^[A-Za-z0-9_-]+$/);
    assert.equal(typeof runtime.redirectToAuthorization, 'function');
    assert.equal((await runtime.validateResourceURL('https://server.example')).href, `${fixture.url}/mcp`);
    await runtime.invalidateCredentials('tokens');
    assert.equal((await store.tokens())?.access_token, undefined);
    const other = await service(t, { name: 'Runtime Client' });
    const override = apply(profile, { authProvider: other.provider }).authProvider;
    assert.equal(override.clientMetadata.client_name, 'Runtime Client');
    assert.equal(apply(profile, { parts: ['http'], authProvider: store }).authProvider, store);
    assert.doesNotMatch(JSON.stringify(profile), /contract-verifier/);
  }

  /**
   * Verify captured callback and auth constraints are checked against live provider state.
   * @returns {Promise<void>} Completes after real provider metadata and credential paths are checked.
   */
  async function registrationConstraints(t) {
    const upstream = await service(t);
    const recorder = capture(fixture.options);
    for (const observation of fixture.observations) recorder.observe(observation);
    recorder.observe({
      phase: 'registration', perspective: 'downstream', status: 201,
      body: { client_id: 'public-registration', redirect_uris: ['http://localhost:43871/callback'], token_endpoint_auth_method: 'none' },
      provenance: { issuer: upstream.url },
    });
    const profile = derive(recorder.finish());
    const registered = profile.oauth.clients.find(
      /**
       * Select the matching issuer and client registration.
       * @param {import('../src/index.js').Registration} value - Public registration.
       * @returns {boolean} Whether it identifies the fixture client.
       */
      function selected(value) { return value.clientId === 'public-registration'; });
    assert.deepEqual(registered.redirectUris, ['http://localhost:43871/callback']);
    assert.equal(registered.authMethod, 'none');
    const compatible = await service(t);
    const runtime = apply(profile, { authProvider: compatible.provider, issuer: upstream.url }).authProvider;
    assert.deepEqual(await runtime.clientInformation(), {
      client_id: 'public-registration', issuer: upstream.url,
      redirect_uris: ['http://localhost:43871/callback'], token_endpoint_auth_method: 'none',
    });
    const incompatible = await service(t, { redirectUrl: 'http://127.0.0.1:0/other' });
    await assert.rejects(
      apply(profile, { authProvider: incompatible.provider, issuer: upstream.url }).authProvider.clientInformation(),
      { code: 'ERR_PROFILES_REGISTRATION' },
    );
    assert.equal((await apply(profile, { authProvider: compatible.provider, issuer: upstream.url }).authProvider.clientInformation()).client_id, 'public-registration');

    const secretRecorder = capture({ client: fixture.options.client, capturedAt: fixture.options.capturedAt });
    secretRecorder.observe({
      phase: 'registration', perspective: 'downstream',
      body: { client_id: 'secret-registration', redirect_uris: ['http://localhost:43871/callback'], token_endpoint_auth_method: 'client_secret_post' },
      provenance: { issuer: upstream.url },
    });
    const secretProfile = derive(secretRecorder.finish());
    const incomplete = await service(t);
    await assert.rejects(
      apply(secretProfile, { authProvider: incomplete.provider, issuer: upstream.url }).authProvider.clientInformation(),
      { code: 'ERR_PROFILES_REGISTRATION' },
    );
  }

  /**
   * Verify immutable provider metadata and ambiguous registrations remain composable.
   * @returns {Promise<void>} Completes after checking real provider state.
   */
  async function immutable(t) {
    const upstream = await service(t);
    const store = Object.freeze(new BoundProvider(upstream.provider));
    const runtime = apply(recorded(), { authProvider: store }).authProvider;
    assert.equal(runtime.clientMetadata.client_name, 'Fixture Desktop');
    await runtime.saveCodeVerifier('runtime-private-field');
    assert.equal(await runtime.codeVerifier(), 'runtime-private-field');
    const recorder = capture(fixture.options);
    for (const observation of fixture.observations) recorder.observe(observation);
    recorder.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: 'another-registration' }, provenance: { issuer: 'https://issuer.example' } });
    const empty = await service(t);
    const ambiguous = apply(derive(recorder.finish()), { authProvider: empty.provider, issuer: 'https://issuer.example' }).authProvider;
    assert.equal(await ambiguous.clientInformation(), undefined);
  }

  /**
   * Exercise official SDK registration, PKCE authorization, exchange, and refresh over HTTP.
   * @returns {Promise<void>} Completes after issuer teardown.
   */
  async function oauth(t) {
    const profile = get('claude-code');
    const applied = apply(profile);
    const fixture = await service(t, { name: 'Fixture Runtime Client', fetch: applied.fetch });
    const runtime = apply(profile, { authProvider: fixture.provider });
    assert.equal(await runtime.authProvider.clientInformation(), undefined);
    const access = await fixture.provider.access();
    const registration = await runtime.authProvider.clientInformation();
    const stored = await runtime.authProvider.tokens();
    assert.equal(stored.access_token, access);
    assert.equal(registration.issuer, new URL(fixture.url).href);
    assert.equal(stored.issuer, new URL(fixture.url).href);
    const refreshed = await fixture.provider.access({ rejected: access });
    assert.notEqual(refreshed, access);
    const revoked = await runtime.fetch(`${fixture.url}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: registration.client_id, token: refreshed, token_type_hint: 'access_token' }),
    });
    assert.equal(revoked.status, 200);
    const registrationEvent = fixture.events.find(
      /** @param {Record<string,any>} event Issuer event. @returns {boolean} Whether dynamic registration occurred. */
      function registered(event) { return event.operation === 'issuer.register'; });
    const consentEvent = fixture.events.find(
      /** @param {Record<string,any>} event Issuer event. @returns {boolean} Whether consent was accepted. */
      function consented(event) { return event.operation === 'issuer.consent'; });
    const exchangeEvent = fixture.events.find(
      /** @param {Record<string,any>} event Issuer event. @returns {boolean} Whether the code was exchanged. */
      function exchanged(event) { return event.operation === 'issuer.exchange'; });
    const refreshEvent = fixture.events.find(
      /** @param {Record<string,any>} event Issuer event. @returns {boolean} Whether refresh occurred. */
      function rotated(event) { return event.operation === 'issuer.refresh'; });
    assert.ok(registrationEvent);
    assert.ok(consentEvent);
    assert.ok(exchangeEvent);
    assert.ok(refreshEvent);
    assert.equal(registration.client_id, registrationEvent.clientId);
    const registrationRequest = fixture.requests.find(
      /** @param {{path:string}} request HTTP request. @returns {boolean} Whether registration was requested. */
      function registered(request) { return request.path === '/register'; });
    const metadataRequest = fixture.requests.find(
      /** @param {{path:string}} request HTTP request. @returns {boolean} Whether protected-resource metadata was requested. */
      function metadata(request) { return request.path === '/.well-known/oauth-protected-resource/mcp'; });
    const exchangeRequest = fixture.requests.find(
      /** @param {{path:string,method:string,body?:Record<string,string>}} request HTTP request. @returns {boolean} Whether a code exchange was requested. */
      function exchanged(request) { return request.path === '/token' && request.method === 'POST' && request.body?.grant_type === 'authorization_code'; });
    const refreshRequest = fixture.requests.find(
      /** @param {{path:string,method:string,body?:Record<string,string>}} request HTTP request. @returns {boolean} Whether refresh was requested. */
      function refreshed(request) { return request.path === '/token' && request.method === 'POST' && request.body?.grant_type === 'refresh_token'; });
    const revokeRequest = fixture.requests.find(
      /** @param {{path:string}} request HTTP request. @returns {boolean} Whether revocation was requested. */
      function revokedRequest(request) { return request.path === '/revoke'; });
    assert.ok(registrationEvent.clientId);
    assert.equal(registrationRequest.body.client_name, 'Fixture Runtime Client');
    assert.equal(metadataRequest.userAgent, 'Bun/1.4.4');
    assert.equal(registrationRequest.userAgent, 'Bun/1.4.4');
    assert.equal(exchangeRequest.userAgent, 'Bun/1.4.4');
    assert.equal(refreshRequest.userAgent, 'Bun/1.4.4');
    assert.equal(revokeRequest.userAgent, 'axios/1.15.2');
  }
  it('preserves Request bodies, SDK headers, aborts, and streaming responses over HTTP', http);
  it('works between official SDK clients and servers with inbound advisory matching', sdk);
  it('binds provider methods to their runtime store and preserves explicit metadata', provider);
  it('validates issuer-bound registration constraints against runtime providers', registrationConstraints);
  it('supports immutable runtime providers and does not guess among registrations', immutable);
  it('applies the verified phase identities to real OAuth discovery, registration, consent, tokens, and revocation', oauth);
}

describe('@mcp-layer/profiles real consumers', suite);
