import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { deriveApiVersion } from '../../src/routing/version.js';

/**
 * Execute version derivation tests.
 * @returns {void}
 */
function versionSuite() {
  it('derives version from semver', function semverCase() {
    const res = deriveApiVersion({ version: '1.2.3' });
    assert.equal(res, 'v1');
  });

  it('derives version from date-based version', function dateCase() {
    const res = deriveApiVersion({ version: '2024-11-05' });
    assert.equal(res, 'v2024');
  });

  it('falls back to v0 when missing', function fallbackCase() {
    const res = deriveApiVersion({});
    assert.equal(res, 'v0');
  });
}

describe('version derivation', versionSuite);
