import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createValidationErrorResponse } from '../../src/errors/mapping.js';
import { ERROR_TYPES } from '../../src/errors/types.js';

/**
 * Execute RFC 9457 formatting tests.
 * @returns {void}
 */
function formatSuite() {
  it('creates problem details with required fields', function formatCase() {
    const res = createValidationErrorResponse('/v1/echo', [{ path: '/', message: 'bad' }], 'req-1');
    assert.equal(res.type, ERROR_TYPES.VALIDATION);
    assert.equal(res.status, 400);
    assert.equal(res.detail, 'Request body failed schema validation');
    assert.equal(res.instance, '/v1/echo');
    assert.equal(res.requestId, 'req-1');
  });
}

describe('error format', formatSuite);
