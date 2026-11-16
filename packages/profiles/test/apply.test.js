import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { discoverAuthorizationServerMetadata, exchangeAuthorization, refreshAuthorization, registerClient, startAuthorization } from '@modelcontextprotocol/sdk/client/auth.js';
import { apply, capture, derive, get, match } from '../src/index.js';
import { listen, read } from './fixtures/http.js';
import { Provider } from './fixtures/provider.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/capture.json', import.meta.url), 'utf8'));

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
  async function provider() {
    const profile = recorded();
    const store = new Provider();
    const runtime = apply(profile, { authProvider: store, issuer: 'https://issuer.example' }).authProvider;
    assert.equal(runtime.clientMetadata.client_name, 'Fixture Desktop');
    assert.deepEqual(runtime.clientMetadata.redirect_uris, [store.redirectUrl]);
    assert.deepEqual(await runtime.clientInformation(), { client_id: 'public-registration', issuer: 'https://issuer.example' });
    assert.equal(await apply(profile, { authProvider: store }).authProvider.clientInformation(), undefined);
    assert.equal(await apply(profile, { authProvider: store, issuer: 'https://other.example' }).authProvider.clientInformation(), undefined);
    runtime.saveClientInformation({ client_id: 'runtime-client', client_secret: 'runtime-secret', issuer: 'https://issuer.example' });
    assert.equal((await runtime.clientInformation()).client_id, 'runtime-client');
    runtime.saveTokens({ access_token: 'runtime-token', refresh_token: 'runtime-refresh', token_type: 'Bearer' });
    assert.equal(runtime.tokens().access_token, 'runtime-token');
    runtime.saveCodeVerifier('runtime-verifier');
    assert.equal(runtime.codeVerifier(), 'runtime-verifier');
    assert.equal(runtime.state(), 'runtime-state');
    runtime.redirectToAuthorization(new URL('https://issuer.example/authorize'));
    assert.equal(store.authorizationUrl.href, 'https://issuer.example/authorize');
    assert.equal((await runtime.validateResourceURL('https://server.example', 'https://runtime.example/mcp')).href, 'https://runtime.example/mcp');
    runtime.invalidateCredentials('tokens');
    assert.equal(store.tokens(), undefined);
    const override = apply(profile, { authProvider: new Provider({ redirect_uris: ['https://runtime.example/callback'], client_name: 'Runtime Client' }) }).authProvider;
    assert.equal(override.clientMetadata.client_name, 'Runtime Client');
    assert.equal(apply(profile, { parts: ['http'], authProvider: store }).authProvider, store);
    assert.doesNotMatch(JSON.stringify(profile), /runtime-token|runtime-secret|runtime-verifier/);
  }

  /**
   * Verify captured callback and auth constraints are checked against live provider state.
   * @returns {Promise<void>} Completes after real provider metadata and credential paths are checked.
   */
  async function registrationConstraints() {
    const recorder = capture(fixture.options);
    for (const observation of fixture.observations) recorder.observe(observation);
    recorder.observe({
      phase: 'registration', perspective: 'downstream', status: 201,
      body: { client_id: 'public-registration', redirect_uris: ['http://localhost:43871/callback'], token_endpoint_auth_method: 'none' },
      provenance: { issuer: 'https://issuer.example' },
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
    const compatible = new Provider({ redirect_uris: ['http://localhost:54000/callback'], token_endpoint_auth_method: 'none' });
    const runtime = apply(profile, { authProvider: compatible, issuer: 'https://issuer.example' }).authProvider;
    assert.deepEqual(await runtime.clientInformation(), {
      client_id: 'public-registration', issuer: 'https://issuer.example',
      redirect_uris: ['http://localhost:43871/callback'], token_endpoint_auth_method: 'none',
    });
    const incompatible = new Provider({ redirect_uris: ['http://127.0.0.1:54000/callback'], token_endpoint_auth_method: 'none' });
    await assert.rejects(
      apply(profile, { authProvider: incompatible, issuer: 'https://issuer.example' }).authProvider.clientInformation(),
      { code: 'ERR_PROFILES_REGISTRATION' },
    );
    const stored = new Provider({ redirect_uris: ['https://runtime.example/callback'], token_endpoint_auth_method: 'client_secret_post' });
    stored.saveClientInformation({ client_id: 'runtime-registration', client_secret: 'runtime-secret', issuer: 'https://issuer.example' });
    assert.equal((await apply(profile, { authProvider: stored, issuer: 'https://issuer.example' }).authProvider.clientInformation()).client_id, 'runtime-registration');

    const secretRecorder = capture({ client: fixture.options.client, capturedAt: fixture.options.capturedAt });
    secretRecorder.observe({
      phase: 'registration', perspective: 'downstream',
      body: { client_id: 'secret-registration', redirect_uris: ['http://localhost:43871/callback'], token_endpoint_auth_method: 'client_secret_post' },
      provenance: { issuer: 'https://issuer.example' },
    });
    const secretProfile = derive(secretRecorder.finish());
    const incomplete = new Provider({ redirect_uris: ['http://localhost:54000/callback'], token_endpoint_auth_method: 'none' });
    await assert.rejects(
      apply(secretProfile, { authProvider: incomplete, issuer: 'https://issuer.example' }).authProvider.clientInformation(),
      { code: 'ERR_PROFILES_REGISTRATION' },
    );
    const extensible = new Provider({ redirect_uris: ['http://localhost:54000/callback'], token_endpoint_auth_method: 'none' });
    /** @returns {void} Runtime SDK hook is responsible for the required client authentication. */
    function authenticate() {}
    extensible.addClientAuthentication = authenticate;
    assert.equal((await apply(secretProfile, { authProvider: extensible, issuer: 'https://issuer.example' }).authProvider.clientInformation()).client_id, 'secret-registration');
  }

  /**
   * Verify immutable provider metadata and ambiguous registrations remain composable.
   * @returns {Promise<void>} Completes after checking real provider state.
   */
  async function immutable() {
    const store = new Provider();
    Object.defineProperty(store, 'clientMetadata', { value: store.clientMetadata, configurable: false, writable: false });
    Object.freeze(store);
    const runtime = apply(recorded(), { authProvider: store }).authProvider;
    assert.equal(runtime.clientMetadata.client_name, 'Fixture Desktop');
    runtime.saveCodeVerifier('runtime-private-field');
    assert.equal(runtime.codeVerifier(), 'runtime-private-field');
    const recorder = capture(fixture.options);
    for (const observation of fixture.observations) recorder.observe(observation);
    recorder.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: 'another-registration' }, provenance: { issuer: 'https://issuer.example' } });
    const ambiguous = apply(derive(recorder.finish()), { authProvider: new Provider(), issuer: 'https://issuer.example' }).authProvider;
    assert.equal(await ambiguous.clientInformation(), undefined);
  }

  /**
   * Exercise official SDK registration, PKCE authorization, exchange, and refresh over HTTP.
   * @returns {Promise<void>} Completes after issuer teardown.
   */
  async function oauth() {
    const requests = [];
    const profile = get('claude-code');
    /**
     * Serve actual OAuth registration and token HTTP endpoints.
     * @param {import('node:http').IncomingMessage} request - OAuth request.
     * @param {import('node:http').ServerResponse} response - OAuth response.
     * @returns {Promise<void>} Endpoint response completion.
     */
    async function handler(request, response) {
      const text = await read(request);
      requests.push({ path: request.url, headers: request.headers, body: text });
      if (request.url === '/.well-known/oauth-authorization-server') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ issuer: endpoint.url, authorization_endpoint: `${endpoint.url}/authorize`, token_endpoint: `${endpoint.url}/token`, registration_endpoint: `${endpoint.url}/register`, response_types_supported: ['code'], token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'] }));
        return;
      }
      response.writeHead(request.url === '/register' ? 201 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(request.url === '/register' ? { ...JSON.parse(text), client_id: 'runtime-registration' } : { access_token: 'runtime-access', token_type: 'Bearer', refresh_token: 'runtime-refresh' }));
    }
    const endpoint = await listen(handler);
    try {
      const provider = new Provider({ redirect_uris: [`${endpoint.url}/callback`], client_name: 'Fixture Runtime Client' });
      const runtime = apply(profile, { authProvider: provider });
      assert.equal(await runtime.authProvider.clientInformation(), undefined);
      const metadata = await discoverAuthorizationServerMetadata(endpoint.url, { fetchFn: runtime.fetch });
      assert.equal(requests[0].path, '/.well-known/oauth-authorization-server');
      assert.equal(requests[0].headers['user-agent'], 'Bun/1.4.4');
      const resourceResponse = await runtime.fetch(`${endpoint.url}/.well-known/oauth-protected-resource/mcp`);
      assert.equal(resourceResponse.status, 200);
      await resourceResponse.json();
      const registration = await registerClient(endpoint.url, { metadata, clientMetadata: runtime.authProvider.clientMetadata, fetchFn: runtime.fetch });
      runtime.authProvider.saveClientInformation(registration);
      const started = await startAuthorization(endpoint.url, { metadata, clientInformation: registration, redirectUrl: runtime.authProvider.redirectUrl, state: 'runtime-state', resource: `${endpoint.url}/mcp` });
      runtime.authProvider.saveCodeVerifier(started.codeVerifier);
      assert.equal(started.authorizationUrl.searchParams.get('redirect_uri'), runtime.authProvider.redirectUrl);
      assert.equal(started.authorizationUrl.searchParams.get('resource'), `${endpoint.url}/mcp`);
      assert.ok(started.authorizationUrl.searchParams.get('code_challenge'));
      const tokens = await exchangeAuthorization(endpoint.url, { metadata, clientInformation: registration, authorizationCode: 'runtime-code', codeVerifier: runtime.authProvider.codeVerifier(), redirectUri: runtime.authProvider.redirectUrl, resource: `${endpoint.url}/mcp`, fetchFn: runtime.fetch });
      runtime.authProvider.saveTokens(tokens);
      await refreshAuthorization(endpoint.url, { metadata, clientInformation: registration, refreshToken: runtime.authProvider.tokens().refresh_token, resource: `${endpoint.url}/mcp`, fetchFn: runtime.fetch });
      await runtime.fetch(`${endpoint.url}/revoke`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: 'runtime-access' }) });
      const registered = requests.find(
        /** @param {{path: string}} value @returns {boolean} Whether the request is registration. */
        function registration(value) { return value.path === '/register'; });
      const tokenRequests = requests.filter(
        /** @param {{path: string}} value @returns {boolean} Whether the request is a token exchange. */
        function token(value) { return value.path === '/token'; });
      const revoked = requests.find(
        /** @param {{path: string}} value @returns {boolean} Whether the request revokes a token. */
        function revocation(value) { return value.path === '/revoke'; });
      const protectedResource = requests.find(
        /** @param {{path: string}} value @returns {boolean} Whether the request discovers a path-aware protected resource. */
        function resource(value) { return value.path === '/.well-known/oauth-protected-resource/mcp'; });
      assert.equal(JSON.parse(registered.body).client_name, 'Fixture Runtime Client');
      assert.deepEqual(JSON.parse(registered.body).redirect_uris, [runtime.authProvider.redirectUrl]);
      assert.equal(registered.headers['user-agent'], 'Bun/1.4.4');
      assert.equal(protectedResource.headers['user-agent'], 'Bun/1.4.4');
      assert.equal(tokenRequests[0].headers['user-agent'], 'Bun/1.4.4');
      assert.equal(tokenRequests[1].headers['user-agent'], 'Bun/1.4.4');
      assert.equal(revoked.headers['user-agent'], 'axios/1.15.2');
      assert.equal(new URLSearchParams(tokenRequests[0].body).get('code_verifier'), started.codeVerifier);
      assert.equal(new URLSearchParams(tokenRequests[0].body).get('resource'), `${endpoint.url}/mcp`);
      assert.equal(new URLSearchParams(tokenRequests[1].body).get('grant_type'), 'refresh_token');
      assert.equal(new URLSearchParams(tokenRequests[1].body).get('refresh_token'), 'runtime-refresh');
    } finally {
      await endpoint.close();
    }
  }
  it('preserves Request bodies, SDK headers, aborts, and streaming responses over HTTP', http);
  it('works between official SDK clients and servers with inbound advisory matching', sdk);
  it('binds provider methods to their runtime store and preserves explicit metadata', provider);
  it('validates issuer-bound registration constraints against runtime providers', registrationConstraints);
  it('supports immutable runtime providers and does not guess among registrations', immutable);
  it('applies the verified phase identities to real OAuth discovery, registration, tokens, and revocation', oauth);
}

describe('@mcp-layer/profiles real consumers', suite);
