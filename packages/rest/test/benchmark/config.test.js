import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { load } from '../../benchmark/config.js';

/**
 * Execute benchmark config tests.
 * @returns {void}
 */
function configSuite() {
  it('uses defaults when no args provided', function defaultsCase() {
    const cfg = load([]);
    assert.equal(cfg.connections, 100);
    assert.equal(cfg.duration, 10);
    assert.equal(cfg.pipelining, 1);
    assert.equal(cfg.sessions, 1);
    assert.equal(cfg.timeout, 10);
    assert.equal(cfg.host, '127.0.0.1');
    assert.equal(cfg.port, 0);
    assert.equal(cfg.tool, 'echo');
    assert.equal(cfg.text, 'hello');
    assert.equal(cfg.loud, false);
    assert.equal(cfg.target, '0');
    assert.equal(cfg.method, 'POST');
    assert.equal(cfg.mode, 'direct');
    assert.equal(cfg.transport, 'memory');
    assert.equal(cfg.payload, '');
    assert.equal(cfg.url, '');
    assert.equal(cfg.authMode, 'optional');
    assert.equal(cfg.authScheme, 'bearer');
    assert.equal(cfg.authHeader, 'authorization');
    assert.equal(cfg.identities, 1);
  });

  it('parses numeric and string overrides', function parseCase() {
    const cfg = load([
      '--connections',
      '200',
      '--duration=20',
      '--pipelining',
      '4',
      '--sessions',
      '3',
      '--timeout',
      '15',
      '--host',
      '0.0.0.0',
      '--port',
      '4000',
      '--tool',
      'echo',
      '--text',
      'hi',
      '--target',
      'bench-1',
      '--method',
      'POST',
      '--mode',
      'manager',
      '--transport',
      'stdio',
      '--payload',
      '{"steps":3,"delayMs":20}',
      '--auth-mode',
      'required',
      '--auth-scheme',
      'raw',
      '--auth-header',
      'authorization',
      '--identities',
      '5'
    ]);

    assert.equal(cfg.connections, 200);
    assert.equal(cfg.duration, 20);
    assert.equal(cfg.pipelining, 4);
    assert.equal(cfg.sessions, 3);
    assert.equal(cfg.timeout, 15);
    assert.equal(cfg.host, '0.0.0.0');
    assert.equal(cfg.port, 4000);
    assert.equal(cfg.tool, 'echo');
    assert.equal(cfg.text, 'hi');
    assert.equal(cfg.target, 'bench-1');
    assert.equal(cfg.method, 'POST');
    assert.equal(cfg.mode, 'manager');
    assert.equal(cfg.transport, 'stdio');
    assert.equal(cfg.payload, '{"steps":3,"delayMs":20}');
    assert.equal(cfg.url, '');
    assert.equal(cfg.authMode, 'required');
    assert.equal(cfg.authScheme, 'raw');
    assert.equal(cfg.authHeader, 'authorization');
    assert.equal(cfg.identities, 5);
  });

  it('parses loud toggles', function loudCase() {
    const cfg = load(['--loud']);
    assert.equal(cfg.loud, true);

    const cfg2 = load(['--loud=false']);
    assert.equal(cfg2.loud, false);

    const cfg3 = load(['--no-loud']);
    assert.equal(cfg3.loud, false);
  });

  it('rejects invalid numeric inputs', async function errorCase() {
    await assert.rejects(
      async function run() {
        load(['--connections', '0']);
      },
      /connections/i
    );

    await assert.rejects(
      async function run() {
        load(['--identities', '0']);
      },
      /identities/i
    );

    await assert.rejects(
      async function run() {
        load(['--payload', '{bad']);
      },
      /payload/i
    );

    await assert.rejects(
      async function run() {
        load(['--port', '-1']);
      },
      /port/i
    );
  });
}

describe('benchmark config', configSuite);
