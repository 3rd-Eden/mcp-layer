import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestMcpServer } from './helpers.js';
import { attach } from '@mcp-layer/attach';
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
}

describe('plugin options', optionsSuite);
