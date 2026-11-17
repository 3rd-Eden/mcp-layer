import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import { Storage } from 'cli-storage';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { build } from '@mcp-layer/test-server';
import { issuer } from '../../src/index.js';

/**
 * Exercise the real SDK consent form with HTTP rather than a browser mock.
 * @param {URL} url - Authorization URL.
 * @param {'allow'|'deny'} [decision] - Actual local consent choice.
 * @returns {Promise<void>} Callback completion.
 */
export async function browser(url, decision = 'allow') {
  const page = await fetch(url);
  const html = await page.text();
  const form = new URLSearchParams();
  for (const input of html.matchAll(/<input\b[^>]*>/g)) {
    const name = input[0].match(/name="([^"]*)"/)?.[1];
    const value = input[0].match(/value="([^"]*)"/)?.[1] ?? '';
    if (name !== undefined) form.set(name, value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  }
  form.set('decision', decision);
  const response = await fetch(new URL('/authorize', url), { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Local OAuth consent failed (${response.status}).`);
}

/**
 * Start a real authenticated SDK MCP server and its OAuth issuer.
 * @param {import('node:test').TestContext} t - Test lifecycle.
 * @param {{resource?:string,scopes?:string[],delayTokenBodyMs?:number}} [options] - Optional PRM resource, scope values, or delayed SDK token body.
 * @returns {Promise<{url:string,directory:string,storage:Storage,tokens:string[],events:object[],provider:object,tokenBodyStarted:Promise<void>}>} Isolated test service.
 */
export async function service(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'mcp-forward-gateway-'));
  const storage = new Storage({ namespace: 'gateway', directory, backend: 'file' });
  const app = express();
  app.use(express.json());
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(/**
   * Observe actual HTTP listener startup.
   * @param {() => void} resolve Resolve after the listener lifecycle event.
   * @param {(error: Error) => void} reject Reject a listener lifecycle error.
   * @returns {void} Complete the asserted operation.
   */
  function listening(resolve, reject) { listener.once('listening', resolve); listener.once('error', reject); });
  const url = `http://127.0.0.1:${listener.address().port}/mcp`;
  const base = new URL('/', url);
  const events = [];
  const tokens = [];
  let startTokenBody;
  const tokenBodyStarted = new Promise(/** @param {() => void} resolve Resolve when the real token response begins. @returns {void} */
  function waiting(resolve) { startTokenBody = resolve; });
  /** @param {object} event - Real issuer operation. @returns {void} */
  function observe(event) { events.push(event); }
  const scopes = options.scopes ?? ['mcp'];
  const resource = options.resource ?? url;
  const provider = issuer({ url: base, resource, storage, observe, scopes });
  if (options.delayTokenBodyMs !== undefined) {
    app.use('/token', /** @param {import('express').Request} req Token request. @param {import('express').Response} res Token response. @param {import('express').NextFunction} next Continue to the SDK token handler. @returns {void} */
    function delayToken(req, res, next) {
      if (req.method !== 'POST') { next(); return; }
      const end = res.end;
      /** Send the real SDK token body after a controlled delay. @param {any[]} args Original response end arguments. @returns {void} */
      function delayed(args) {
        startTokenBody?.();
        const timer = setTimeout(/** @returns {void} Complete the delayed SDK response. */
        function finish() { Reflect.apply(end, res, args); }, options.delayTokenBodyMs);
        res.once('close', /** @returns {void} Cancel an unused delayed token response. */
        function disconnected() { clearTimeout(timer); });
      }
      res.end = /**
       * Flush response headers before forwarding the real token body on schedule.
       * @param {any[]} args - Original response end arguments.
       * @returns {import('express').Response} The response after scheduling its end.
       */
      function endResponse(...args) {
        res.flushHeaders();
        delayed(args);
        return res;
      };
      next();
    });
  }
  if (options.resource !== undefined || options.scopes !== undefined) {
    const metadataUrl = new URL(getOAuthProtectedResourceMetadataUrl(new URL(url)));
    app.get(metadataUrl.pathname, /** @param {import('express').Request} req Metadata request. @param {import('express').Response} res Metadata response. @returns {void} */
    function metadata(req, res) { res.json({ resource, authorization_servers: [base.href], scopes_supported: scopes }); });
  }
  app.use(mcpAuthRouter({ provider, issuerUrl: base, resourceServerUrl: new URL(url), scopesSupported: scopes }));
  app.use('/mcp', requireBearerAuth({ verifier: provider, expectedResource: new URL(resource), requiredScopes: scopes, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(url)) }));
  const server = build();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  await server.connect(transport);
  app.all('/mcp', /**
   * Record actual protected-resource requests before SDK dispatch.
   * @param {import('express').Request} req Incoming resource request.
   * @param {import('express').Response} res Resource response.
   * @param {import('express').NextFunction} next Continue to the SDK transport.
   * @returns {void} Complete the asserted operation.
   */
  function request(req, res, next) {
    tokens.push(req.headers.authorization);
    void transport.handleRequest(req, res, req.body).catch(next);
  });
  t.after(/**
   * Release owned test servers, transports, providers, or temporary records.
   * @returns {Promise<void>} Resolve when owned resource cleanup completes.
   */
  async function cleanup() {
    await transport.close();
    await server.close();
    listener.closeAllConnections();
    await new Promise(/**
     * Observe owned listener shutdown.
     * @param {() => void} resolve Resolve after the listener lifecycle event.
     * @returns {void} Complete the asserted operation.
     */
    function closed(resolve) { listener.close(resolve); });
    await rm(directory, { recursive: true, force: true });
  });
  return { url, directory, storage, tokens, events, provider, tokenBodyStarted };
}
