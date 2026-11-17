import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import path from 'node:path';
import express from 'express';
import { Storage } from 'cli-storage';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { authorize, issuer } from '@mcp-layer/forward';

/**
 * Reserve and release an ephemeral port for an actual OAuth callback listener.
 * @returns {Promise<number>} Available loopback port selected by the operating system.
 */
async function callbackPort() {
  const server = createServer();
  await new Promise(/** @param {() => void} resolve Listener startup. @param {(error: Error) => void} reject Startup failure. @returns {void} */
  function listening(resolve, reject) { server.once('listening', resolve); server.once('error', reject); server.listen(0, '127.0.0.1'); });
  const port = server.address().port;
  await new Promise(/** @param {() => void} resolve Listener shutdown. @param {(error: Error) => void} reject Shutdown failure. @returns {void} */
  function closed(resolve, reject) { server.close(/** @param {Error} [error] Listener close error. @returns {void} Settle listener shutdown. */
  function close(error) { if (error) reject(error); else resolve(); }); });
  return port;
}

/**
 * Submit the actual issuer consent form and complete its redirect.
 * @param {URL} url - SDK generated authorization URL.
 * @returns {Promise<void>} Resolves after the issuer accepts consent.
 */
export async function consent(url) {
  const page = await fetch(url);
  const html = await page.text();
  const form = new URLSearchParams();
  for (const tag of html.matchAll(/<input\b[^>]*>/g)) {
    const name = tag[0].match(/name="([^"]*)"/)?.[1];
    const value = tag[0].match(/value="([^"]*)"/)?.[1] ?? '';
    if (name !== undefined) form.set(name, value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  }
  form.set('decision', 'allow');
  const response = await fetch(new URL('/authorize', url), { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Issuer consent failed (${response.status}).`);
}

/**
 * Start an actual SDK authorization server with isolated cli-storage files.
 * @param {import('node:test').TestContext} t - Test lifecycle and cleanup hooks.
 * @param {{name?:string,redirectUrl?:string,resource?:string,clientInformation?:object,fetch?:typeof fetch}} [options] - Runtime registration and fetch options.
 * @returns {Promise<{url:string,directory:string,storage:Storage,provider:import('@mcp-layer/forward').Authorization,events:object[]}>} Issuer and client fixture.
 */
export async function service(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mcp-profiles-oauth-'));
  const storage = new Storage({ namespace: 'profiles', directory, backend: 'file' });
  const app = express();
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(/** @param {() => void} resolve Listener startup. @param {(error: Error) => void} reject Startup failure. @returns {void} */
  function listening(resolve, reject) { listener.once('listening', resolve); listener.once('error', reject); });
  const url = `http://127.0.0.1:${listener.address().port}`;
  const events = [];
  const requests = [];
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  /** Record real requests before the SDK router handles them. @param {import('express').Request} request - Incoming OAuth request. @param {import('express').Response} response - OAuth response. @param {import('express').NextFunction} next - SDK router continuation. @returns {void} Continue routing. */
  function record(request, response, next) {
    requests.push({ path: request.path, method: request.method, userAgent: request.get('user-agent'), body: request.body });
    next();
  }
  app.use(record);
  /** Record issuer operations produced by the public SDK router. @param {object} event - Issuer event. @returns {void} */
  function observe(event) { events.push(event); }
  const serverProvider = issuer({ url, resource: `${url}/mcp`, storage, observe });
  app.use(mcpAuthRouter({ provider: serverProvider, issuerUrl: new URL(url), resourceServerUrl: new URL(`${url}/mcp`), scopesSupported: ['mcp'] }));
  const redirectUrl = options.redirectUrl ?? `http://localhost:${await callbackPort()}/callback`;
  const client = authorize({
    target: `${url}/mcp`,
    storage,
    resource: options.resource ?? `${url}/mcp`,
    clientMetadata: { client_name: options.name ?? 'Fixture Desktop' },
    redirectUrl,
    ...(options.clientInformation === undefined ? {} : { clientInformation: options.clientInformation }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    open: consent,
  });
  t.after(/** Close client, server listener, and filesystem records. @returns {Promise<void>} Cleanup completion. */
  async function cleanup() {
    await client.close();
    listener.closeAllConnections();
    await new Promise(/** @param {() => void} resolve Listener shutdown. @returns {void} */
    function closed(resolve) { listener.close(resolve); });
    await rm(directory, { recursive: true, force: true });
  });
  return { url, directory, storage, provider: client, events, requests };
}
