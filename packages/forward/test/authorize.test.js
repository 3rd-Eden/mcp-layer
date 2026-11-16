import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { once } from 'node:events';
import { fork } from 'node:child_process';
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
 * @param {string} [resourcePath] Path advertised as the issuer's protected resource.
 * @returns {Promise<{url:string,resource:string,directory:string,storage:Storage,events:object[]}>} Issuer fixture.
 */
async function fixture(t, resourcePath = '/mcp') {
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
  const resource = `${url}${resourcePath}`;
  const provider = issuer({ url, resource, storage, observe });
  app.use(mcpAuthRouter({ provider, issuerUrl: new URL(url), resourceServerUrl: new URL(resource), scopesSupported: ['mcp'] }));
  return { url, resource, directory, storage, events };
}

/** Wait a bounded interval for real storage-lock contention to settle.
 * @param {number} milliseconds Maximum wait duration.
 * @returns {Promise<void>} Completion after the timer.
 */
function pause(milliseconds) { return new Promise(/** @param {() => void} resolve Resolve when the wait expires. @returns {void} */
function elapsed(resolve) { setTimeout(resolve, milliseconds); }); }

let serial = 0;

/** Start an independent process using the shared public OAuth store.
 * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
 * @param {{url:string,directory:string}} upstream Real issuer URL and private storage root.
 * @returns {import('node:child_process').ChildProcess} Running public provider process.
 */
function worker(t, upstream) {
  const child = fork(new URL('./fixtures/authorize-process.mjs', import.meta.url), [upstream.url, upstream.directory], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  t.after(/** @returns {Promise<void>} Terminate the worker if a test exits early. */
  function cleanup() {
    if (child.exitCode !== null) return Promise.resolve();
    return new Promise(/** @param {() => void} resolve Resolve after process exit. @returns {void} */
    function exited(resolve) { child.once('exit', resolve); child.kill('SIGTERM'); });
  });
  return child;
}

/** Ask one worker to run a public provider operation.
 * @param {import('node:child_process').ChildProcess} child Running worker.
 * @param {'access'|'refresh'|'close'} action Provider operation.
 * @returns {Promise<Record<string,unknown>>} Safe worker status and token digest.
 */
async function command(child, action) {
  const id = ++serial;
  const response = once(child, 'message');
  child.send({ id, action });
  const [message] = await response;
  assert.equal(message.id, id);
  return message;
}

/** Close a worker and wait for its process to exit.
 * @param {import('node:child_process').ChildProcess} child Running worker.
 * @returns {Promise<void>} Completion after provider and process shutdown.
 */
async function stop(child) {
  const exited = once(child, 'exit');
  const response = await command(child, 'close');
  assert.equal(response.status, 'closed');
  await exited;
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

  it('serializes upstream OAuth login and refresh across independent processes and reuses records after restart', /**
   * Verify separate public authorize() clients share one real login, one refresh, and persisted tokens.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete operation-count, digest, and restart assertions.
   */
  async function processes(t) {
    const upstream = await fixtureFor(t);
    const first = worker(t, upstream);
    const second = worker(t, upstream);
    const initial = await Promise.all([command(first, 'access'), command(second, 'access')]);
    assert.ok(initial.every(/** @param {Record<string,any>} result Safe worker result. @returns {boolean} */
    function succeeded(result) { return result.status === 'fulfilled'; }));
    assert.match(initial[0].digest, /^[a-f0-9]{64}$/);
    assert.equal(initial[1].digest, initial[0].digest);
    assert.equal(initial[0].state.registered, true);
    assert.equal(upstream.events.filter(/** @param {Record<string,any>} event Issuer operation. @returns {boolean} */
    function registered(event) { return event.operation === 'issuer.register'; }).length, 1);
    assert.equal(upstream.events.filter(/** @param {Record<string,any>} event Issuer operation. @returns {boolean} */
    function consented(event) { return event.operation === 'issuer.consent'; }).length, 1);
    assert.equal(upstream.events.filter(/** @param {Record<string,any>} event Issuer operation. @returns {boolean} */
    function exchanged(event) { return event.operation === 'issuer.exchange'; }).length, 1);

    const refreshed = await Promise.all([command(first, 'refresh'), command(second, 'refresh')]);
    assert.ok(refreshed.every(/** @param {Record<string,any>} result Safe worker result. @returns {boolean} */
    function succeeded(result) { return result.status === 'fulfilled'; }));
    assert.match(refreshed[0].digest, /^[a-f0-9]{64}$/);
    assert.equal(refreshed[1].digest, refreshed[0].digest);
    assert.notEqual(refreshed[0].digest, initial[0].digest);
    assert.equal(upstream.events.filter(/** @param {Record<string,any>} event Issuer operation. @returns {boolean} */
    function rotated(event) { return event.operation === 'issuer.refresh'; }).length, 1);

    const restarted = worker(t, upstream);
    const reused = await command(restarted, 'access');
    assert.equal(reused.status, 'fulfilled');
    assert.equal(reused.digest, refreshed[0].digest);
    assert.equal(upstream.events.filter(/** @param {Record<string,any>} event Issuer operation. @returns {boolean} */
    function exchanged(event) { return event.operation === 'issuer.exchange'; }).length, 1);
    assert.equal(upstream.events.filter(/** @param {Record<string,any>} event Issuer operation. @returns {boolean} */
    function rotated(event) { return event.operation === 'issuer.refresh'; }).length, 1);

    await Promise.all([stop(first), stop(second), stop(restarted)]);
  });

  it('redacts target query credentials from authorization status while preserving request URLs', /**
   * Verify credential diagnostics omit target query data while the provider keeps its configured URL.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Complete the public API assertions.
   */
  async function safeStatus(t) {
    const upstream = await fixtureFor(t);
    const target = `${upstream.url}/mcp?api_key=secret`;
    const provider = authorize({ target, storage: upstream.storage });
    t.after(/** @returns {Promise<void>} Close provider resources. */
    function close() { return provider.close(); });
    const discovery = await provider.discover();
    const status = await provider.status();
    assert.equal(status.target, upstream.url);
    assert.equal(status.issuer, upstream.url);
    assert.doesNotMatch(JSON.stringify(status), /secret/);
    assert.equal(discovery.state.resourceMetadata.resource, `${upstream.url}/mcp`);
    assert.equal(provider.target, target);
  });

  it('redacts token and session path credentials from authorization status', /**
   * Verify origin-only diagnostic targets do not expose token-like or session-like path values.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Both public status results contain only the upstream origin.
   */
  async function pathStatus(t) {
    for (const resourcePath of ['/tokens/path-sentinel', '/sessions/session-sentinel']) {
      const upstream = await fixtureFor(t, resourcePath);
      const provider = authorize({ target: upstream.resource, storage: upstream.storage });
      t.after(/** @returns {Promise<void>} Close provider resources. */
      function close() { return provider.close(); });
      const status = await provider.status();
      assert.equal(status.target, upstream.url);
      assert.equal(status.issuer, upstream.url);
      assert.equal(JSON.stringify(status).includes(resourcePath.split('/').at(-1)), false);
      assert.equal(provider.target, upstream.resource);
    }
  });

  it('cancels queued access on close before the real storage lease is released', /**
   * Verify close aborts cli-storage lock acquisition without starting browser or callback work.
   * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
   * @returns {Promise<void>} Queued and already-closed access calls reject before lease release.
   */
  async function closeQueued(t) {
    const upstream = await fixtureFor(t);
    let opened = 0;
    /** Count actual browser launch callbacks. @param {URL} url SDK authorization URL. @returns {Promise<void>} Real consent flow if incorrectly started. */
    async function open(url) { opened++; await browser(url); }
    const provider = authorize({ target: `${upstream.url}/mcp`, storage: upstream.storage, open });
    t.after(/** @returns {Promise<void>} Close provider resources. */
    function close() { return provider.close(); });
    const discovery = await provider.discover();
    let release;
    let acquire;
    const released = new Promise(/** @param {() => void} resolve Release the real cli-storage lease. @returns {void} */
    function holding(resolve) { release = resolve; });
    const acquired = new Promise(/** @param {() => void} resolve Resolve after the lease is acquired. @returns {void} */
    function ready(resolve) { acquire = resolve; });
    const holder = upstream.storage.lock(discovery.key, /** @returns {Promise<void>} Hold the real lease until the test releases it. */
    async function hold() { acquire(); await released; });
    await acquired;
    const pending = provider.access();
    await pause(30);
    await provider.close();
    const result = await Promise.race([
      pending.then(/** @returns {{status:string}} */ function fulfilled() { return { status: 'fulfilled' }; },
        /** @param {Error & {code?:string}} error Rejected authorization. @returns {{status:string,code?:string}} */
        function rejected(error) { return { status: 'rejected', code: error.code }; }),
      pause(150).then(/** @returns {{status:string}} */ function waiting() { return { status: 'pending' }; }),
    ]);
    try {
      assert.deepEqual(result, { status: 'rejected', code: 'ERR_OAUTH_CLOSED' });
      assert.equal(opened, 0);
      assert.equal(provider.transport, undefined);
    } finally {
      release();
      await holder;
    }
    await assert.rejects(provider.access(), { code: 'ERR_OAUTH_CLOSED' });
    assert.equal(opened, 0);
    assert.equal(provider.transport, undefined);

    const alreadyClosed = authorize({ target: `${upstream.url}/mcp`, storage: upstream.storage, open });
    await alreadyClosed.close();
    await assert.rejects(alreadyClosed.access(), { code: 'ERR_OAUTH_CLOSED' });
    assert.equal(alreadyClosed.transport, undefined);
    assert.equal(opened, 0);
  });
}

/** Avoid a name collision with fixture values. @param {import('node:test').TestContext} t - Test lifecycle. @returns {ReturnType<typeof fixture>} */
function fixtureFor(t, resourcePath) { return fixture(t, resourcePath); }

describe('@mcp-layer/forward authorize', suite);
