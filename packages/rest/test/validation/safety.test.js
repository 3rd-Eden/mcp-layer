import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { checkSchemaSafety } from '../../src/validation/safety.js';

/**
 * Build safety config fixture.
 * @returns {{ maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number }}
 */
function config() {
  return {
    maxSchemaDepth: 1,
    maxSchemaSize: 200,
    maxPatternLength: 10
  };
}

/**
 * Execute schema safety tests.
 * @returns {void}
 */
function safetySuite() {
  it('rejects schemas that exceed depth', function depthCase() {
    const schema = { type: 'object', properties: { a: { type: 'object', properties: { b: { type: 'object' } } } } };
    const res = checkSchemaSafety(schema, config());
    assert.equal(res.safe, false);
  });

  it('rejects schemas that exceed size', function sizeCase() {
    const schema = { type: 'object', properties: { payload: { type: 'string' } } };
    const cfg = config();
    cfg.maxSchemaSize = 10;
    const res = checkSchemaSafety(schema, cfg);
    assert.equal(res.safe, false);
  });

  it('rejects schemas with overly long patterns', function patternLengthCase() {
    const schema = { type: 'string', pattern: 'aaaaaaaaaaa' };
    const res = checkSchemaSafety(schema, config());
    assert.equal(res.safe, false);
  });

  it('rejects schemas with ReDoS patterns', function redosCase() {
    const schema = { type: 'string', pattern: '(a+)+$' };
    const res = checkSchemaSafety(schema, config());
    assert.equal(res.safe, false);
  });

  it('accepts safe schemas', function okCase() {
    const schema = { type: 'object', properties: { name: { type: 'string' } } };
    const res = checkSchemaSafety(schema, config());
    assert.equal(res.safe, true);
  });
}

describe('schema safety checks', safetySuite);
