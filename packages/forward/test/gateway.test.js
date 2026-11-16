import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { authorize, forward } from '../src/index.js';
import { browser, service } from './fixtures/oauth-server.mjs';

/** Register complete real downstream/upstream OAuth tests. @returns {void} */
function suite() {
  it('uses distinct downstream and upstream tokens through a streamed SDK session', /**
   * Verify uses distinct downstream and upstream tokens through a streamed SDK session.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function gateway(t) {
    const upstream = await service(t);
    const runtime = await forward({ target: upstream.url, storage: upstream.storage, oauth: { open: browser } });
    t.after(runtime.close);
    const downstream = authorize({ target: runtime.url, storage: upstream.storage, open: browser });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function close() { return downstream.close(); });
    const client = new Client({ name: 'gateway-client', version: '1.0.0' });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function close() { return client.close(); });
    const token = await downstream.access();
    await client.connect(new StreamableHTTPClientTransport(new URL(runtime.url), { fetch: downstream.fetch }));
    assert.ok((await client.listTools()).tools.length > 0);
    assert.ok(upstream.tokens.length > 0);
    assert.ok(upstream.tokens.every(/**
     * Compare an upstream bearer header with the downstream credential.
     * @param {string} value Observed upstream authorization header.
     * @returns {boolean} Whether the credentials are distinct.
     */
    function distinct(value) { return value !== `Bearer ${token}`; }));
    const old = upstream.tokens.at(-1).slice('Bearer '.length);
    const identity = await upstream.provider.verifyAccessToken(old);
    const registration = await upstream.provider.clientsStore.getClient(identity.clientId);
    await upstream.provider.revokeToken(registration, { token: old });
    assert.ok((await client.listTools()).tools.length > 0);
    assert.notEqual(upstream.tokens.at(-1), `Bearer ${old}`);
    const invalid = await fetch(runtime.url, { headers: { authorization: upstream.tokens[0] } });
    assert.equal(invalid.status, 401);
    assert.ok(!JSON.stringify(await runtime.status()).includes(token));
  });
}

describe('@mcp-layer/forward gateway', suite);
