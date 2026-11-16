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
 * @returns {Promise<{url:string,storage:Storage,tokens:string[],events:object[],provider:object}>} Isolated test service.
 */
export async function service(t) {
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
  /** @param {object} event - Real issuer operation. @returns {void} */
  function observe(event) { events.push(event); }
  const provider = issuer({ url: base, resource: url, storage, observe });
  app.use(mcpAuthRouter({ provider, issuerUrl: base, resourceServerUrl: new URL(url), scopesSupported: ['mcp'] }));
  app.use('/mcp', requireBearerAuth({ verifier: provider, expectedResource: new URL(url), requiredScopes: ['mcp'], resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(new URL(url)) }));
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
  return { url, storage, tokens, events, provider };
}
