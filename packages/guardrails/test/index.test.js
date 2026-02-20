import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createGuardrails,
  denyTools,
  egressPolicy,
  principalPolicy,
  piiRedact,
  secretDetect,
  payloadLimits,
  ratePolicy
} from '../src/index.js';

/**
 * Execute guardrails package tests.
 * @returns {void}
 */
function suite() {
  it('denies configured tools', function denyToolsCase() {
    const plugin = denyTools({ names: ['danger.*'] });
    const context = {
      method: 'tools/call',
      params: { name: 'danger.delete', arguments: {} },
      meta: {}
    };

    assert.throws(
      function thrower() {
        plugin.before(context);
      },
      function verify(error) {
        assert.equal(error.code, 'GUARDRAIL_DENIED');
        return true;
      }
    );
  });

  it('redacts pii in request and response payloads', function piiCase() {
    const plugin = piiRedact();
    const context = {
      params: { email: 'john@example.com', text: 'Call me 555-123-4567' },
      result: { body: 'SSN 123-45-6789' },
      meta: {}
    };

    plugin.before(context);
    plugin.after(context);

    assert.match(String(context.params.email), /REDACTED_EMAIL/);
    assert.match(String(context.params.text), /REDACTED_PHONE/);
    assert.match(String(context.result.body), /REDACTED_SSN/);
  });

  it('blocks secrets in request payloads', function secretCase() {
    const plugin = secretDetect();
    const context = {
      params: { token: 'Bearer ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
      meta: {}
    };

    assert.throws(
      function thrower() {
        plugin.before(context);
      },
      function verify(error) {
        assert.equal(error.code, 'GUARDRAIL_DENIED');
        return true;
      }
    );
  });

  it('enforces payload limits', function payloadCase() {
    const plugin = payloadLimits({ maxStringLength: 4 });
    const context = {
      params: { text: 'abcdef' },
      meta: {}
    };

    assert.throws(
      function thrower() {
        plugin.before(context);
      },
      function verify(error) {
        assert.equal(error.code, 'GUARDRAIL_DENIED');
        return true;
      }
    );
  });

  it('enforces rate limits by session id', function rateCase() {
    const plugin = ratePolicy({ limit: 1, intervalMs: 60000 });
    const context = {
      sessionId: 'abc',
      params: {},
      meta: {}
    };

    plugin.before(context);

    assert.throws(
      function thrower() {
        plugin.before(context);
      },
      function verify(error) {
        assert.equal(error.code, 'RATE_LIMITED');
        return true;
      }
    );
  });

  it('blocks IPv4-mapped loopback targets in egress policy', async function egressCase() {
    const plugin = egressPolicy();
    const context = {
      method: 'tools/call',
      params: {},
      meta: { egressUrl: 'http://[::ffff:127.0.0.1]/scan' }
    };

    await assert.rejects(
      plugin.before(context),
      function verify(error) {
        assert.equal(error.code, 'EGRESS_POLICY_DENIED');
        return true;
      }
    );
  });

  it('allows private egress targets when explicitly enabled', async function allowPrivateCase() {
    const plugin = egressPolicy({ allowPrivateIps: true });
    const context = {
      method: 'tools/call',
      params: {},
      meta: { egressUrl: 'http://127.0.0.1/scan' }
    };

    await assert.doesNotReject(
      plugin.before(context)
    );
  });

  it('blocks disallowed egress ports when allow-list is configured', async function portCase() {
    const plugin = egressPolicy({
      allowPrivateIps: true,
      allowedPorts: [443]
    });
    const context = {
      method: 'tools/call',
      params: {},
      meta: { egressUrl: 'http://127.0.0.1:9000/scan' }
    };

    await assert.rejects(
      plugin.before(context),
      function verify(error) {
        assert.equal(error.code, 'EGRESS_POLICY_DENIED');
        return true;
      }
    );
  });

  it('allows configured egress ports when policy is satisfied', async function allowPortCase() {
    const plugin = egressPolicy({
      allowPrivateIps: true,
      allowedPorts: [80]
    });
    const context = {
      method: 'tools/call',
      params: {},
      meta: { egressUrl: 'http://127.0.0.1/scan' }
    };

    await assert.doesNotReject(
      plugin.before(context)
    );
  });

  it('caches successful DNS resolutions within configured TTL', async function dnsCacheCase() {
    let calls = 0;

    /**
     * Resolve hostnames to deterministic public addresses for cache testing.
     * @param {string} host - Hostname to resolve.
     * @returns {Promise<{ addresses: string[] }>}
     */
    async function resolve(host) {
      calls += 1;
      return { addresses: [`203.0.113.${calls}`, host.length > 0 ? '198.51.100.1' : '198.51.100.2'] };
    }

    const plugin = egressPolicy({
      allowPrivateIps: true,
      dnsCacheTtlMs: 1000,
      resolve
    });
    const context = {
      method: 'tools/call',
      params: {},
      meta: { egressUrl: 'https://example.com/scan' }
    };

    await assert.doesNotReject(plugin.before(context));
    await assert.doesNotReject(plugin.before(context));
    assert.equal(calls, 1);
  });

  it('refreshes DNS cache entries after TTL expires', async function dnsCacheExpiryCase() {
    let calls = 0;

    /**
     * Resolve hostnames to deterministic public addresses for cache expiry testing.
     * @returns {Promise<{ addresses: string[] }>}
     */
    async function resolve() {
      calls += 1;
      return { addresses: ['198.51.100.10'] };
    }

    const plugin = egressPolicy({
      allowPrivateIps: true,
      dnsCacheTtlMs: 10,
      resolve
    });
    const context = {
      method: 'tools/call',
      params: {},
      meta: { egressUrl: 'https://example.com/scan' }
    };

    await assert.doesNotReject(plugin.before(context));
    await new Promise(function wait(resolveWait) {
      setTimeout(resolveWait, 30);
    });
    await assert.doesNotReject(plugin.before(context));
    assert.equal(calls, 2);
  });

  it('builds strict profile plugins', function profileCase() {
    const list = createGuardrails({ profile: 'strict' });
    const names = list.map(function map(item) {
      return item.name;
    });

    assert.equal(names.includes('approval-gate'), true);
    assert.equal(names.includes('egress-policy'), true);
    assert.equal(names.includes('rate-policy'), true);
  });

  it('enforces principal-specific tool policy rules', function principalToolCase() {
    const plugin = principalPolicy({
      principals: {
        analyst: {
          allowTools: ['echo']
        }
      }
    });

    const allowed = {
      method: 'tools/call',
      params: { name: 'echo', arguments: {} },
      meta: { principal: 'analyst' }
    };
    const denied = {
      method: 'tools/call',
      params: { name: 'danger.delete', arguments: {} },
      meta: { principal: 'analyst' }
    };

    assert.doesNotThrow(function allowCase() {
      plugin.before(allowed);
    });

    assert.throws(
      function denyCase() {
        plugin.before(denied);
      },
      function verify(error) {
        assert.equal(error.code, 'GUARDRAIL_DENIED');
        return true;
      }
    );
  });

  it('requires principal metadata when principal policies are configured', function principalRequiredCase() {
    const plugin = principalPolicy({
      principals: {
        analyst: {
          allowTools: ['echo']
        }
      }
    });
    const context = {
      method: 'tools/call',
      params: { name: 'echo', arguments: {} },
      meta: {}
    };

    assert.throws(
      function denyCase() {
        plugin.before(context);
      },
      function verify(error) {
        assert.equal(error.code, 'GUARDRAIL_DENIED');
        return true;
      }
    );
  });
}

describe('guardrails', suite);
