import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTestMcpServer } from '../helpers.js';
import { attach } from '@mcp-layer/attach';
import { createValidator } from '../../src/validation/validator.js';

/**
 * Build a sample input schema.
 * @returns {Record<string, unknown>}
 */
function inputSchema() {
  return {
    type: 'object',
    properties: { msg: { type: 'string' } },
    required: ['msg']
  };
}

/**
 * Execute validator tests.
 * @returns {void}
 */
function validatorSuite() {
  it('registers and validates tool inputs', async function toolSchemaCase() {
    const mcp = createTestMcpServer({ name: 'validator', version: '1.0.0' });
    const session = await attach(mcp, 'validator');

    try {
      const validator = createValidator({
        trustSchemas: true,
        maxSchemaDepth: 10,
        maxSchemaSize: 1024,
        maxPatternLength: 100
      }, session);

      const reg = validator.registerToolSchema('echo', inputSchema());
      assert.equal(reg.success, true);

      const ok = validator.validate('tool', 'echo', { msg: 'hi' });
      assert.equal(ok.valid, true);

      const bad = validator.validate('tool', 'echo', { });
      assert.equal(bad.valid, false);
    } finally {
      await session.close();
      await mcp.close();
    }
  });

  it('returns error for unknown schemas', async function unknownCase() {
    const mcp = createTestMcpServer({ name: 'validator', version: '1.0.0' });
    const session = await attach(mcp, 'validator');

    try {
      const validator = createValidator({
        trustSchemas: true,
        maxSchemaDepth: 10,
        maxSchemaSize: 1024,
        maxPatternLength: 100
      }, session);

      const res = validator.validate('tool', 'missing', {});
      assert.equal(res.valid, false);
      assert.equal(res.errors[0].message.includes('Unknown tool'), true);
    } finally {
      await session.close();
      await mcp.close();
    }
  });
}

describe('schema validator', validatorSuite);
