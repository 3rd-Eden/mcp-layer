import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMcpErrorResponse } from '../../src/errors/mapping.js';
import { ERROR_TYPES } from '../../src/errors/types.js';

/**
 * Execute MCP error mapping tests.
 * @returns {void}
 */
function mapSuite() {
  it('maps MCP error codes to HTTP responses', function mapCase() {
    const err = new Error('Not found');
    err.code = -32601;
    const res = createMcpErrorResponse(err, '/v1/echo', 'req-1');
    assert.equal(res.status, 404);
    assert.equal(res.type, ERROR_TYPES.NOT_FOUND);
    assert.equal(res.mcpErrorCode, -32601);
  });
}

describe('error mapping', mapSuite);
