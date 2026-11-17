import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { apply, capture, derive } from '../src/index.js';

const implementation = JSON.parse(await readFile(new URL('./fixtures/implementation.json', import.meta.url), 'utf8'));

/**
 * Record a public implementation through a real public capture boundary.
 * @param {object} info - Observed public implementation metadata.
 * @returns {import('../src/index.js').Recorder} Recorder containing the initialize observation.
 */
function record(info) {
  const recorder = capture({ capturedAt: '2026-11-16T00:00:00.000Z' });
  recorder.observe({ phase: 'mcp', perspective: 'downstream', message: { method: 'initialize', params: { protocolVersion: '2025-11-25', clientInfo: info, capabilities: {} } } });
  return recorder;
}

/** @returns {void} Register standard implementation fidelity scenarios. */
function suite() {
  /**
   * Verify standard implementation fields survive capture, derive, apply, and the official SDK.
   * @returns {Promise<void>} Completes after the actual SDK connection closes.
   */
  async function metadata() {
    const recorder = record({ ...implementation, privateExtension: 'fixture-secret-extension' });
    const captured = recorder.finish();
    assert.equal(captured.observations[0].message.params.clientInfo.title, implementation.title);
    assert.equal(captured.observations[0].message.params.clientInfo.icons[0].theme, 'light');
    assert.doesNotMatch(JSON.stringify(captured), /fixture-secret-/);
    const profile = derive(captured);
    assert.deepEqual(profile.client, implementation);
    assert.deepEqual(profile.mcp.clientInfo, implementation);
    const runtime = apply(profile);
    assert.deepEqual(runtime.info, implementation);
    const [outbound, inbound] = InMemoryTransport.createLinkedPair();
    const client = new Client(runtime.info);
    const server = new Server({ name: 'fidelity-server', version: '1.0.0' });
    try {
      await server.connect(inbound);
      await client.connect(outbound);
      assert.deepEqual(server.getClientVersion(), implementation);
    } finally {
      await client.close();
      await server.close();
    }
  }
  /** @returns {void} Verify public URL fields cannot export or reuse embedded credentials. */
  function urls() {
    const recorder = record({
      ...implementation,
      websiteUrl: 'https://person:fixture-secret-password@client.example/?access_token=fixture-secret-token',
      icons: [
        { src: 'https://client.example/icon.png?code=fixture-secret-code', mimeType: 'image/png' },
        { ...implementation.icons[0], privateExtension: 'fixture-secret-icon' },
      ],
    });
    const captured = recorder.finish();
    assert.doesNotMatch(JSON.stringify(captured), /fixture-secret-/);
    const profile = derive(captured);
    assert.equal(profile.mcp.clientInfo.websiteUrl, undefined);
    assert.deepEqual(profile.mcp.clientInfo.icons, implementation.icons);
    assert.deepEqual(apply(profile).info.icons, implementation.icons);
  }
  /** @returns {void} Verify optional metadata merges without inventing absent fields. */
  function partial() {
    const recorder = record(implementation);
    recorder.observe({ phase: 'mcp', perspective: 'downstream', message: { method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/clientInfo': { name: implementation.name, version: implementation.version } } } } });
    assert.deepEqual(derive(recorder.finish()).mcp.clientInfo, implementation);
    const declared = derive(capture({ client: { ...implementation, platform: 'fixture-os', privateExtension: 'fixture-secret-declared' } }).finish());
    assert.deepEqual(declared.client, { ...implementation, platform: 'fixture-os' });
    assert.deepEqual(declared.mcp.clientInfo, implementation);
    assert.doesNotMatch(JSON.stringify(declared), /fixture-secret-/);
  }
  /** @returns {void} Verify modern request metadata and HTTP version headers remain observed evidence. */
  function versions() {
    const recorder = record(implementation);
    const capabilities = { roots: { listChanged: true }, elicitation: { form: {}, url: {} } };
    const observed = recorder.observe({ phase: 'mcp', perspective: 'downstream', headers: { 'mcp-protocol-version': '2026-07-28' }, message: { method: 'server/discover', params: { _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientInfo': implementation,
      'io.modelcontextprotocol/clientCapabilities': capabilities,
      unknownExtension: 'fixture-secret-meta',
    } } } });
    assert.equal(observed.message.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
    assert.deepEqual(observed.message.params._meta['io.modelcontextprotocol/clientCapabilities'], capabilities);
    const profile = derive(recorder.finish());
    assert.deepEqual(profile.mcp.observed.protocolVersions, ['2025-11-25', '2026-07-28']);
    assert.ok(profile.mcp.observed.capabilities.some(
      /**
       * Locate the actual modern capability observation.
       * @param {object} value - Sanitized observed capabilities.
       * @returns {boolean} Whether capabilities match the observed modern request.
       */
      function actual(value) { return JSON.stringify(value) === JSON.stringify(capabilities); }));
    assert.doesNotMatch(JSON.stringify(profile), /fixture-secret-/);
  }
  it('preserves every safe standard implementation field through official SDK consumers', metadata);
  it('redacts URL secrets and excludes modified URLs from reusable identity', urls);
  it('merges partial observed and declared standard metadata without unknown passthrough', partial);
  it('records actual modern and legacy protocol versions and capabilities without selecting them', versions);
}

describe('@mcp-layer/profiles native fidelity', suite);
