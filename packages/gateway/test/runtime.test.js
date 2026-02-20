import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { attach } from '@mcp-layer/attach';
import { build } from '@mcp-layer/test-server';
import { createManager } from '@mcp-layer/manager';
import { createRuntime } from '../src/runtime.js';

/**
 * Build a fake request object for runtime tests.
 * @param {Record<string, unknown>} [headers] - Request headers.
 * @returns {import('fastify').FastifyRequest}
 */
function request(headers = {}) {
  return /** @type {import('fastify').FastifyRequest} */ ({
    id: 'req-1',
    url: '/graphql',
    headers,
  });
}

/**
 * Execute runtime tests.
 * @returns {void}
 */
function runtimeSuite() {
  it('creates runtime context with catalog and validator', async function contextCase() {
    const server = build({ info: { version: '1.4.0' } });
    const session = await attach(server, 'gateway');

    try {
      const runtime = await createRuntime({ session });
      assert.equal(runtime.contexts.length, 1);
      assert.equal(runtime.contexts[0].version, 'v1');
      assert.equal(runtime.contexts[0].prefix, '/v1');

      const valid = runtime.contexts[0].validator.validate('tool', 'echo', { text: 'ok', loud: false });
      const invalid = runtime.contexts[0].validator.validate('tool', 'echo', { loud: false });

      assert.equal(valid.valid, true);
      assert.equal(invalid.valid, false);

      await runtime.close();
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('uses strict guardrail profile by default', async function defaultGuardrailsCase() {
    const server = build();
    const session = await attach(server, 'gateway');

    try {
      const runtime = await createRuntime({ session });
      assert.equal(runtime.config.guardrails.profile, 'strict');
      await runtime.close();
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('executes tool calls and preserves tool error payloads', async function toolCase() {
    const server = build();
    const session = await attach(server, 'gateway');

    try {
      const runtime = await createRuntime({ session });
      const context = runtime.contexts[0];

      const success = await context.execute(request(), 'tools/call', {
        name: 'echo',
        arguments: { text: 'hello', loud: false }
      });

      const failure = await context.execute(request(), 'tools/call', {
        name: 'fail-gracefully',
        arguments: {}
      });

      assert.equal(success.content[0].text, 'hello');
      assert.equal(failure.isError, true);

      await runtime.close();
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('surfaces manager auth failures through resolve', async function managerCase() {
    const server = build();
    const bootstrap = await attach(server, 'bootstrap');

    /**
     * Create auth-aware session factory.
     * @returns {Promise<import('@mcp-layer/session').Session>}
     */
    async function factory() {
      return bootstrap;
    }

    const manager = createManager({
      auth: { mode: 'required' },
      factory
    });

    try {
      const runtime = await createRuntime({
        session: bootstrap,
        manager
      });

      await assert.rejects(
        async function rejectCase() {
          await runtime.contexts[0].resolve(request());
        },
        /authorization header is required/i
      );

      await runtime.close();
    } finally {
      await bootstrap.close();
      await server.close();
    }
  });

  it('executes with pre-resolved session context without duplicate manager lookups', async function resolvedExecuteCase() {
    const server = build();
    const bootstrap = await attach(server, 'bootstrap');
    let count = 0;

    /**
     * Resolve sessions for manager-mode runtime.
     * @returns {Promise<import('@mcp-layer/session').Session>}
     */
    async function get() {
      count += 1;
      return bootstrap;
    }

    try {
      const runtime = await createRuntime({
        session: bootstrap,
        manager: { get }
      });

      const context = runtime.contexts[0];
      const resolved = await context.resolve(request());
      assert.equal(count, 1);

      const result = await context.execute(
        request(),
        'tools/call',
        { name: 'echo', arguments: { text: 'pre-resolved', loud: false } },
        { surface: 'tools', toolName: 'echo', sessionId: resolved.session.name },
        resolved
      );

      assert.equal(result.content[0].text, 'pre-resolved');
      assert.equal(count, 1);

      await runtime.close();
    } finally {
      await bootstrap.close();
      await server.close();
    }
  });

  it('respects breaker timeout for slow tools', async function timeoutCase() {
    const server = build();
    const session = await attach(server, 'gateway');

    try {
      const runtime = await createRuntime({
        session,
        resilience: {
          enabled: true,
          timeout: 5,
          errorThresholdPercentage: 50,
          resetTimeout: 50,
          volumeThreshold: 1
        }
      });

      await assert.rejects(
        async function timeoutReject() {
          await runtime.contexts[0].execute(request(), 'tools/call', {
            name: 'slow',
            arguments: {}
          });
        }
      );

      assert.ok(runtime.breakers.has('gateway'));

      await runtime.close();
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('creates telemetry helpers when enabled', async function telemetryCase() {
    const server = build();
    const session = await attach(server, 'gateway');

    try {
      const runtime = await createRuntime({
        session,
        telemetry: {
          enabled: true,
          serviceName: 'gateway-test',
          metricPrefix: 'gateway'
        }
      });

      assert.ok(runtime.contexts[0].telemetry);
      assert.ok(runtime.contexts[0].telemetry.metrics.callDuration);

      await runtime.close();
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('runs transport and schema plugin phases', async function phaseCase() {
    const server = build();
    const session = await attach(server, 'gateway');

    try {
      const runtime = await createRuntime({
        session,
        plugins: [
          {
            name: 'transport-phase',
            transport: function transport(context) {
              context.meta = { ...context.meta, touched: true };
            },
            before: function before(context) {
              if (context.method !== 'tools/call') return;
              context.params = {
                ...context.params,
                arguments: {
                  ...context.params.arguments,
                  text: 'patched'
                }
              };
            },
            schema: function schema(context) {
              context.catalog = {
                ...(context.catalog ?? {}),
                xTag: 'ok'
              };
            }
          }
        ]
      });

      assert.equal(runtime.contexts[0].catalog.xTag, 'ok');

      const result = await runtime.contexts[0].execute(request(), 'tools/call', {
        name: 'echo',
        arguments: { text: 'hello', loud: false }
      });

      assert.equal(result.content[0].text, 'patched');
      await runtime.close();
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('enforces guardrails in runtime execution', async function guardrailCase() {
    const server = build();
    const session = await attach(server, 'gateway');

    try {
      const runtime = await createRuntime({
        session,
        guardrails: {
          denyTools: ['echo']
        }
      });

      await assert.rejects(
        runtime.contexts[0].execute(request(), 'tools/call', {
          name: 'echo',
          arguments: { text: 'blocked', loud: false }
        }),
        function verify(error) {
          assert.equal(error.code, 'GUARDRAIL_DENIED');
          return true;
        }
      );

      await runtime.close();
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('rejects non-strict guardrails when policy lock mode is enabled', async function policyLockProfileCase() {
    const server = build();
    const session = await attach(server, 'gateway');

    try {
      await assert.rejects(
        createRuntime({
          session,
          policy: {
            lock: true
          },
          guardrails: {
            profile: 'baseline'
          }
        }),
        function verify(error) {
          assert.equal(error.code, 'POLICY_LOCKED');
          return true;
        }
      );
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('rejects custom plugins when policy lock mode is enabled', async function policyLockPluginCase() {
    const server = build();
    const session = await attach(server, 'gateway');

    try {
      await assert.rejects(
        createRuntime({
          session,
          policy: {
            lock: true
          },
          plugins: [
            {
              name: 'custom',
              before: function before() {}
            }
          ]
        }),
        function verify(error) {
          assert.equal(error.code, 'POLICY_LOCKED');
          return true;
        }
      );
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('forwards plugin trace events from runtime pipeline to configured sink', async function pipelineTraceCase() {
    const server = build();
    const session = await attach(server, 'gateway');
    const events = [];

    /**
     * Capture plugin pipeline trace events.
     * @param {Record<string, unknown>} event - Trace event payload.
     * @returns {void}
     */
    function sink(event) {
      events.push(event);
    }

    try {
      const runtime = await createRuntime({
        session,
        pipeline: {
          trace: {
            enabled: true,
            collect: false,
            sink
          }
        },
        plugins: [
          {
            name: 'trace-plugin',
            before: function before(context) {
              context.meta = {
                ...(context.meta ?? {}),
                traceTouched: true
              };
            }
          }
        ]
      });

      await runtime.contexts[0].execute(request(), 'tools/call', {
        name: 'echo',
        arguments: { text: 'trace', loud: false }
      });

      assert.equal(events.length > 0, true);
      assert.equal(events.some(function hasBefore(entry) {
        return entry.plugin === 'trace-plugin' && entry.phase === 'before';
      }), true);

      await runtime.close();
    } finally {
      await session.close();
      await server.close();
    }
  });
}

describe('gateway runtime', runtimeSuite);
