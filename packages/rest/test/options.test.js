import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestMcpServer } from './helpers.js';
import { attach } from '@mcp-layer/attach';
import { composeCatalog } from '@mcp-layer/schema';
import { validateOptions } from '../src/config/validate.js';

/**
 * Execute options validation tests.
 * @returns {void}
 */
function optionsSuite() {
  it('requires a session option', async function requiredCase() {
    await assert.rejects(
      async function run() {
        validateOptions({});
      },
      /session.*required/i
    );
  });

  it('applies defaults when options are missing', async function defaultsCase() {
    const mcp = createTestMcpServer({ name: 'opts', version: '1.0.0' });
    const session = await attach(mcp, 'opts');

    try {
      const cfg = validateOptions({ session });
      assert.equal(cfg.exposeOpenAPI, true);
      assert.equal(cfg.validation.trustSchemas, 'auto');
      assert.equal(cfg.resilience.enabled, true);
      assert.equal(cfg.telemetry.enabled, false);
    } finally {
      await session.close();
      await mcp.close();
    }
  });

  it('rejects invalid prefix values', async function prefixCase() {
    const mcp = createTestMcpServer({ name: 'opts', version: '1.0.0' });
    const session = await attach(mcp, 'opts');

    try {
      await assert.rejects(
        async function run() {
          validateOptions({ session, prefix: 123 });
        },
        /prefix/i
      );
    } finally {
      await session.close();
      await mcp.close();
    }
  });

  it('rejects invalid validation limits', async function validationCase() {
    const mcp = createTestMcpServer({ name: 'opts', version: '1.0.0' });
    const session = await attach(mcp, 'opts');

    try {
      await assert.rejects(
        async function run() {
          validateOptions({
            session,
            validation: {
              maxSchemaDepth: 0
            }
          });
        },
        /maxSchemaDepth/i
      );
    } finally {
      await session.close();
      await mcp.close();
    }
  });

  it('requires a bootstrap session or catalog when manager is provided', async function managerCase() {
    await assert.rejects(
      async function run() {
        validateOptions({ manager: { get: async function get() {} } });
      },
      /session.*catalog.*required|catalog.*session.*required/i
    );
  });

  it('accepts a catalog when manager is provided without a bootstrap session', async function managerCatalogCase() {
    const catalog = composeCatalog({
      server: {
        info: { name: 'catalog', version: '1.0.0' },
        capabilities: { tools: {} },
      },
      tools: [{
        name: 'echo',
        description: 'Echo text.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string' },
          },
          required: ['text'],
        },
      }],
    });

    const cfg = validateOptions({
      catalog,
      manager: { get: async function get() {} },
    });

    assert.equal(cfg.catalog.server.info.name, 'catalog');
    assert.equal(Array.isArray(cfg.catalog.items), true);
  });

  it('rejects manager with multiple sessions', async function managerMultiCase() {
    const mcp = createTestMcpServer({ name: 'opts', version: '1.0.0' });
    const session = await attach(mcp, 'opts');

    try {
      await assert.rejects(
        async function run() {
          validateOptions({ session: [session, session], manager: { get: async function get() {} } });
        },
        /manager.*multiple/i
      );
    } finally {
      await session.close();
      await mcp.close();
    }
  });
}

describe('plugin options', optionsSuite);
