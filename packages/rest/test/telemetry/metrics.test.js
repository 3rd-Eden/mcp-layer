import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetry } from '../../src/telemetry/index.js';

/**
 * Execute telemetry metric tests.
 * @returns {void}
 */
function metricsSuite() {
  it('creates telemetry instruments when enabled', function metricsCase() {
    const tel = createTelemetry({ enabled: true, serviceName: 'test' });
    assert.ok(tel);
    assert.ok(tel.metrics);
    assert.ok(tel.metrics.callDuration);
    assert.ok(tel.metrics.callErrors);
    assert.ok(tel.metrics.validationErrors);
  });

  it('returns null when disabled', function disabledCase() {
    const tel = createTelemetry({ enabled: false, serviceName: 'test' });
    assert.equal(tel, null);
  });
}

describe('telemetry metrics', metricsSuite);
