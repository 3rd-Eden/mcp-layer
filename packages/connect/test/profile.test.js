import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { capture, derive } from '@mcp-layer/profiles';
import { connect } from '../src/index.js';
import { service } from './fixtures/profile-server.mjs';

/** @returns {import('@mcp-layer/profiles').Profile} An evidence-backed public identity. */
function profile() {
  const recorder = capture({ client: { name: 'observed-client', version: '2.0.0' } });
  recorder.observe({ phase: 'mcp', perspective: 'downstream', headers: { 'user-agent': 'observed-client/2.0.0' }, message: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'observed-client', version: '2.0.0' } } }, provenance: { role: 'client' } });
  return derive(recorder.finish());
}

describe('connect',
  /**
   * Register connect integration coverage.
   * @returns {void} Completion of the real test operation.
   */
  function suite() {
    describe('profiles',
      /**
       * Register profiles integration coverage.
       * @returns {void} Completion of the real test operation.
       */
      function profiles() {
        for (const transport of ['streamable-http', 'sse']) {
          it(`applies HTTP and initialize identity over ${transport}`,
            /**
             * Verify identity.
             * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
             * @returns {Promise<void>} Completion of the real test operation.
             */
            async function identity(t) {
              const runtime = await service();
              t.after(runtime.close);
              const src = new Map([['demo', { name: 'demo', source: '/tmp/mcp.json', config: { url: `${runtime.url}/${transport === 'sse' ? 'sse' : 'mcp'}` } }]]);
              const session = await connect(src, 'demo', { transport, profile: profile() });
              await session.client.ping();
              await session.close();
              const initialize = runtime.observations.find(
                /**
                 * Select initializing evidence.
                 * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
                 * @returns {boolean} Whether the boundary observation matches.
                 */
                function initializing(value) { return value.message?.method === 'initialize'; });
              assert.deepEqual(initialize.message.params.clientInfo, { name: 'observed-client', version: '2.0.0' });
              for (const request of runtime.observations) assert.equal(request.headers['user-agent'], 'observed-client/2.0.0');
              assert.equal(session.transport.constructor.name, transport === 'sse' ? 'SSEClientTransport' : 'StreamableHTTPClientTransport');
            });
        }
        it('lets explicit runtime metadata win and selects profile parts',
          /**
           * Verify lets explicit runtime metadata win and selects profile parts.
           * @param {import('node:test').TestContext} t Test lifecycle and cleanup hooks.
           * @returns {Promise<void>} Completion of the real test operation.
           */
          async function overrides(t) {
            const runtime = await service();
            t.after(runtime.close);
            const src = new Map([['demo', { name: 'demo', source: '/tmp/mcp.json', config: { url: `${runtime.url}/mcp` } }]]);
            const session = await connect(src, 'demo', { profile: profile(), parts: ['mcp'], info: { name: 'runtime', version: '3.0.0' }, requestInit: { headers: { 'user-agent': 'runtime/3.0.0' } } });
            await session.close();
            const initialize = runtime.observations.find(
              /**
               * Select initializing evidence.
               * @param {import('@mcp-layer/profiles').Evidence} value Sanitized observation from the real transport.
               * @returns {boolean} Whether the boundary observation matches.
               */
              function initializing(value) { return value.message?.method === 'initialize'; });
            assert.deepEqual(initialize.message.params.clientInfo, { name: 'runtime', version: '3.0.0' });
            assert.equal(initialize.headers['user-agent'], 'runtime/3.0.0');
          });
      });
  });
