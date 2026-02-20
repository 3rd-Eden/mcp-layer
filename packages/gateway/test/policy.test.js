import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { policy } from '../src/index.js';

/**
 * Execute policy mapping tests.
 * @returns {void}
 */
function suite() {
  it('maps shared policy codes to HTTP and GraphQL metadata', function mapCase() {
    const mapped = policy('GUARDRAIL_DENIED');
    assert.equal(mapped?.code, 'GUARDRAIL_DENIED');
    assert.equal(mapped?.httpStatus, 403);
    assert.equal(mapped?.graphqlCode, 'FORBIDDEN');
  });

  it('returns null for unknown policy codes', function unknownCase() {
    const mapped = policy('UNKNOWN_CODE');
    assert.equal(mapped, null);
  });
}

describe('policy mapping', suite);

