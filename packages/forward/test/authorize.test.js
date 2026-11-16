import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { Storage } from 'cli-storage';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { authorize, issuer } from '../src/index.js';

/** Submit the actual local consent form and follow its callback.
 * @param {URL} url - SDK authorization URL.
 * @returns {Promise<void>} Completed browser interaction.
 */
async function browser(url) {
  const page = await fetch(url);
  const html = await page.text();
  const form = new URLSearchParams();
  for (const tag of html.matchAll(/<input\b[^>]*>/g)) {
    const name = tag[0].match(/name="([^"]*)"/)?.[1];
    const value = tag[0].match(/value="([^"]*)"/)?.[1];
    if (name !== undefined) form.set(name, (value ?? '').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  }
  form.set('decision', 'allow');
  const response = await fetch(new URL('/authorize', url), { method: 'POST', body: form });
  assert.equal(response.status, 200);
}

/** Start an actual SDK OAuth issuer and isolated filesystem store.
 * @param {import('node:test').TestContext} t - Test lifecycle.
 * @returns {Promise<{url:string,storage:Storage,events:object[]}>} Issuer fixture.
 */
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mcp-forward-auth-'));
  t.after(/**
   * Release owned test servers, transports, providers, or temporary records.
   * @returns {Promise<void>} Resolve when owned resource cleanup completes.
   */
  function cleanup() { return rm(directory, { recursive: true, force: true }); });
  const storage = new Storage({ namespace: 'oauth', directory, backend: 'file' });
  const app = express();
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(/**
   * Observe actual HTTP listener startup.
   * @param {() => void} resolve Resolve after the listener lifecycle event.
   * @param {(error: Error) => void} reject Reject a listener lifecycle error.
   * @returns {void} Complete the asserted operation.
   */
  function listening(resolve, reject) { listener.once('listening', resolve); listener.once('error', reject); });
  t.after(/**
   * Release owned test servers, transports, providers, or temporary records.
   * @returns {Promise<void>} Resolve when owned resource cleanup completes.
   */
  function cleanup() { listener.closeAllConnections(); return new Promise(/**
   * Observe owned listener shutdown.
   * @param {() => void} resolve Resolve after the listener lifecycle event.
   * @returns {void} Complete the asserted operation.
   */
  function closed(resolve) { listener.close(resolve); }); });
  const url = `http://127.0.0.1:${listener.address().port}`;
  const events = [];
  /** Record actual OAuth operations. @param {object} event - Observation. @returns {void} */
  function observe(event) { events.push(event); }
  const provider = issuer({ url, resource: `${url}/mcp`, storage, observe });
  app.use(mcpAuthRouter({ provider, issuerUrl: new URL(url), resourceServerUrl: new URL(`${url}/mcp`), scopesSupported: ['mcp'] }));
  return { url, storage, events };
}

/** Register OAuth client integration tests. @returns {void} */
function suite() {
  it('uses SDK discovery, registration and PKCE, reuses credentials and rotates refresh tokens', /**
   * Verify uses SDK discovery, registration and PKCE, reuses credentials and rotates refresh tokens.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function roundtrip(t) {
    const fixture = await fixtureFor(t);
    let logins = 0;
    /** Complete real consent, counting actual interactive logins. @param {URL} url - Authorization URL. @returns {Promise<void>} */
    async function open(url) { logins++; await browser(url); }
    const options = { target: `${fixture.url}/mcp`, storage: fixture.storage, open };
    const first = authorize(options);
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return first.close(); });
    const token = await first.access();
    assert.equal(typeof token, 'string');
    assert.equal(logins, 1);
    const second = authorize(options);
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return second.close(); });
    assert.equal(await second.access(), token);
    assert.equal(logins, 1);
    const refreshed = await second.access({ rejected: token });
    assert.notEqual(refreshed, token);
    assert.equal(logins, 1);
    assert.equal(await first.access(), refreshed);
    assert.equal((await second.status()).registered, true);
    assert.ok(!JSON.stringify(await second.status()).includes(refreshed));
  });

  it('serializes parallel provider instances through cli-storage', /**
   * Verify serializes parallel provider instances through cli-storage.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function concurrent(t) {
    const fixture = await fixtureFor(t);
    let logins = 0;
    /** Count real browser grants. @param {URL} url - Authorization URL. @returns {Promise<void>} */
    async function open(url) { logins++; await browser(url); }
    const one = authorize({ target: `${fixture.url}/mcp`, storage: fixture.storage, open });
    const two = authorize({ target: `${fixture.url}/mcp`, storage: fixture.storage, open });
    t.after(/**
     * Release owned test servers, transports, providers, or temporary records.
     * @returns {Promise<void[]>} Resolve when owned resource cleanup completes.
     */
    function cleanup() { return Promise.all([one.close(), two.close()]); });
    const tokens = await Promise.all([one.access(), two.access()]);
    assert.equal(tokens[0], tokens[1]);
    assert.equal(logins, 1);
    const rotated = await Promise.all([one.access({ rejected: tokens[0] }), two.access({ rejected: tokens[0] })]);
    assert.equal(rotated[0], rotated[1]);
  });
}

/** Avoid a name collision with fixture values. @param {import('node:test').TestContext} t - Test lifecycle. @returns {ReturnType<typeof fixture>} */
function fixtureFor(t) { return fixture(t); }

describe('@mcp-layer/forward authorize', suite);
