import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LayerError } from '@mcp-layer/error';
import { createPipeline, runPipeline, runSchema, runTransport } from '../src/index.js';

/**
 * Run plugin package tests.
 * @returns {void}
 */
function suite() {
  it('applies transport and schema hooks before operation phases', async function phaseCase() {
    const pipeline = createPipeline({
      plugins: [
        {
          name: 'transport',
          transport: function transport(context) {
            context.method = String(context.method).replace('tools/call', 'tools/call');
            context.meta = { ...context.meta, transport: 'patched' };
          }
        },
        {
          name: 'schema',
          schema: function schema(context) {
            const catalog = context.catalog && typeof context.catalog === 'object'
              ? context.catalog
              : { items: [] };

            context.catalog = {
              ...catalog,
              x: 'patched'
            };
          }
        }
      ]
    });

    const transport = await runTransport(pipeline, {
      method: 'tools/call',
      params: {},
      meta: {}
    });

    const schema = await runSchema(pipeline, {
      method: 'schema/extract',
      catalog: { items: [] },
      meta: {}
    });

    assert.equal(transport.meta.transport, 'patched');
    assert.equal(schema.catalog.x, 'patched');
  });

  it('applies before and after hooks in order', async function applyHooksCase() {
    const pipeline = createPipeline({
      plugins: [
        {
          name: 'before',
          before: function before(context) {
            context.params = { value: Number(context.params?.value ?? 0) + 1 };
          }
        },
        {
          name: 'after',
          after: function after(context) {
            context.result = Number(context.result) + 2;
          }
        }
      ]
    });

    const context = await runPipeline(
      pipeline,
      { method: 'tools/call', params: { value: 2 }, meta: {} },
      async function execute(input) {
        return Number(input.params?.value ?? 0);
      }
    );

    assert.equal(context.result, 5);
  });

  it('maps thrown plugin failures to PLUGIN_BLOCKED', async function blockedCase() {
    const pipeline = createPipeline({
      plugins: [
        {
          name: 'broken',
          before: function broken() {
            throw new Error('boom');
          }
        }
      ]
    });

    await assert.rejects(
      runPipeline(pipeline, { method: 'tools/call', params: {}, meta: {} }, async function execute() {
        return { ok: true };
      }),
      function verify(error) {
        assert.equal(error.code, 'PLUGIN_BLOCKED');
        return true;
      }
    );
  });

  it('keeps guardrail denials unchanged', async function passThroughCase() {
    const denial = new LayerError({
      name: 'guardrails',
      method: 'denyTools',
      message: 'Denied.',
      code: 'GUARDRAIL_DENIED'
    });

    const pipeline = createPipeline({
      plugins: [
        {
          name: 'deny',
          before: function deny() {
            throw denial;
          }
        }
      ]
    });

    await assert.rejects(
      runPipeline(pipeline, { method: 'tools/call', params: {}, meta: {} }, async function execute() {
        return { ok: true };
      }),
      function verify(error) {
        assert.equal(error, denial);
        return true;
      }
    );
  });

  it('times out slow plugin handlers', async function timeoutCase() {
    const pipeline = createPipeline({
      timeoutMs: 5,
      plugins: [
        {
          name: 'slow',
          before: async function slow() {
            await new Promise(function wait(resolve) {
              setTimeout(resolve, 25);
            });
          }
        }
      ]
    });

    await assert.rejects(
      runPipeline(pipeline, { method: 'tools/call', params: {}, meta: {} }, async function execute() {
        return { ok: true };
      }),
      function verify(error) {
        assert.equal(error.code, 'PLUGIN_TIMEOUT');
        return true;
      }
    );
  });

  it('collects plugin trace metrics when tracing is enabled', async function traceCollectCase() {
    const pipeline = createPipeline({
      trace: {
        enabled: true,
        collect: true
      },
      plugins: [
        {
          name: 'before',
          before: function before(context) {
            context.params = { value: Number(context.params?.value ?? 0) + 1 };
          }
        },
        {
          name: 'after',
          after: function after(context) {
            context.result = Number(context.result) + 1;
          }
        }
      ]
    });

    const context = await runPipeline(
      pipeline,
      { method: 'tools/call', params: { value: 2 }, meta: {} },
      async function execute(input) {
        return Number(input.params?.value ?? 0);
      }
    );

    const events = Array.isArray(context.meta?.pluginTrace) ? context.meta.pluginTrace : [];
    assert.equal(events.length, 2);
    assert.equal(events[0].plugin, 'before');
    assert.equal(events[0].phase, 'before');
    assert.equal(events[0].status, 'ok');
    assert.equal(events[1].plugin, 'after');
    assert.equal(events[1].phase, 'after');
    assert.equal(events[1].status, 'ok');
  });

  it('emits timeout trace events to sink', async function traceSinkTimeoutCase() {
    const events = [];

    /**
     * Collect trace events from pipeline hooks.
     * @param {Record<string, unknown>} event - Trace payload.
     * @returns {void}
     */
    function sink(event) {
      events.push(event);
    }

    const pipeline = createPipeline({
      timeoutMs: 5,
      trace: {
        enabled: true,
        collect: false,
        sink
      },
      plugins: [
        {
          name: 'slow',
          before: async function slow() {
            await new Promise(function wait(resolve) {
              setTimeout(resolve, 25);
            });
          }
        }
      ]
    });

    await assert.rejects(
      runPipeline(pipeline, { method: 'tools/call', params: {}, meta: {} }, async function execute() {
        return { ok: true };
      }),
      function verify(error) {
        assert.equal(error.code, 'PLUGIN_TIMEOUT');
        return true;
      }
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].plugin, 'slow');
    assert.equal(events[0].phase, 'before');
    assert.equal(events[0].status, 'timeout');
  });
}

describe('plugin pipeline', suite);
