import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { LayerError } from '@mcp-layer/error';

const load = createRequire(import.meta.url);
const Supply = load('supply');
const DEFAULT_TIMEOUT_MS = 2000;
const PASS_CODES = new Set([
  'GUARDRAIL_DENIED',
  'EGRESS_POLICY_DENIED',
  'APPROVAL_REQUIRED',
  'RATE_LIMITED',
  'PLUGIN_TIMEOUT'
]);
const HOOKS = ['transport', 'schema', 'before', 'after', 'error'];
const TRACE_DEBUG = /^1|true|yes$/i;

/**
 * Test whether a value is a plain object.
 * @param {unknown} value - Value to inspect.
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Validate one plugin hook field.
 * @param {Record<string, unknown>} input - Plugin definition.
 * @param {'transport' | 'schema' | 'before' | 'after' | 'error'} hook - Hook name.
 * @returns {void}
 */
function checkHook(input, hook) {
  if (input[hook] !== undefined && typeof input[hook] !== 'function') {
    throw new LayerError({
      name: 'plugin',
      method: 'definePlugin',
      message: 'Plugin "{plugin}" {hook} handler must be a function.',
      vars: { plugin: String(input.name ?? 'unknown'), hook },
      code: 'PLUGIN_INVALID'
    });
  }
}

/**
 * Validate and normalize a plugin definition.
 * @param {Record<string, unknown>} input - Plugin definition.
 * @returns {{ name: string, transport?: (context: Record<string, unknown>) => unknown, schema?: (context: Record<string, unknown>) => unknown, before?: (context: Record<string, unknown>) => unknown, after?: (context: Record<string, unknown>) => unknown, error?: (context: Record<string, unknown>) => unknown }}
 */
export function definePlugin(input) {
  if (!isRecord(input)) {
    throw new LayerError({
      name: 'plugin',
      method: 'definePlugin',
      message: 'Plugin definition must be an object.',
      code: 'PLUGIN_INVALID'
    });
  }

  if (typeof input.name !== 'string' || input.name.length === 0) {
    throw new LayerError({
      name: 'plugin',
      method: 'definePlugin',
      message: 'Plugin name must be a non-empty string.',
      code: 'PLUGIN_INVALID'
    });
  }

  checkHook(input, 'transport');
  checkHook(input, 'schema');
  checkHook(input, 'before');
  checkHook(input, 'after');
  checkHook(input, 'error');

  return {
    name: input.name,
    transport: input.transport,
    schema: input.schema,
    before: input.before,
    after: input.after,
    error: input.error
  };
}

/**
 * Build a plugin timeout error.
 * @param {string} plugin - Plugin name.
 * @param {'transport' | 'schema' | 'before' | 'after' | 'error'} phase - Phase name.
 * @param {number} timeoutMs - Timeout value.
 * @returns {LayerError}
 */
function timeoutError(plugin, phase, timeoutMs) {
  return new LayerError({
    name: 'plugin',
    method: 'runPipeline',
    message: 'Plugin "{plugin}" timed out in "{phase}" phase after {timeout}ms.',
    vars: { plugin, phase, timeout: timeoutMs },
    code: 'PLUGIN_TIMEOUT',
    plugin,
    phase,
    timeoutMs
  });
}

/**
 * Build a wrapped plugin failure error.
 * @param {string} plugin - Plugin name.
 * @param {'transport' | 'schema' | 'before' | 'after' | 'error'} phase - Phase name.
 * @param {unknown} cause - Underlying error.
 * @returns {LayerError}
 */
function blockedError(plugin, phase, cause) {
  if (cause instanceof LayerError && PASS_CODES.has(String(cause.code ?? ''))) return cause;
  return new LayerError({
    name: 'plugin',
    method: 'runPipeline',
    message: 'Plugin "{plugin}" failed in "{phase}" phase.',
    vars: { plugin, phase },
    code: 'PLUGIN_BLOCKED',
    plugin,
    phase,
    cause
  });
}

/**
 * Merge a returned patch into the active pipeline context.
 * @param {Record<string, unknown>} target - Mutable context.
 * @param {unknown} patch - Returned value from a plugin hook.
 * @returns {void}
 */
function mergeContext(target, patch) {
  if (!isRecord(patch)) return;

  for (const [key, value] of Object.entries(patch)) {
    if (key === 'meta' && isRecord(target.meta) && isRecord(value)) {
      target.meta = { ...target.meta, ...value };
      continue;
    }

    target[key] = value;
  }
}

/**
 * Resolve whether plugin trace mode should be enabled.
 * @param {unknown} value - Optional trace input override.
 * @returns {boolean}
 */
function traceEnabled(value) {
  if (typeof value === 'boolean') return value;
  return TRACE_DEBUG.test(String(process.env.MCP_LAYER_DEBUG ?? ''));
}

/**
 * Write one debug trace event to stderr.
 * @param {Record<string, unknown>} event - Trace event payload.
 * @returns {void}
 */
function traceWrite(event) {
  const operationId = String(event.operationId ?? 'unknown');
  const phase = String(event.phase ?? 'unknown');
  const plugin = String(event.plugin ?? 'unknown');
  const status = String(event.status ?? 'unknown');
  const duration = Number(event.durationMs ?? 0).toFixed(2);
  process.stderr.write(`[mcp-layer:plugin] op=${operationId} phase=${phase} plugin=${plugin} status=${status} durationMs=${duration}\n`);
}

/**
 * Emit plugin phase tracing metadata without impacting request outcomes.
 * @param {{ enabled: boolean, collect: boolean, sink?: (event: Record<string, unknown>) => void }} trace - Trace configuration.
 * @param {Record<string, unknown>} context - Phase context.
 * @param {{ plugin: string, phase: 'transport' | 'schema' | 'before' | 'after' | 'error', status: 'ok' | 'error' | 'timeout', durationMs: number, errorCode?: string }} entry - Trace payload.
 * @returns {void}
 */
function emitTrace(trace, context, entry) {
  if (!trace.enabled) return;

  if (!isRecord(context.meta)) context.meta = {};

  const event = {
    at: new Date().toISOString(),
    operationId: String(context.operationId ?? ''),
    surface: String(context.surface ?? ''),
    method: String(context.method ?? ''),
    sessionId: String(context.sessionId ?? ''),
    plugin: entry.plugin,
    phase: entry.phase,
    status: entry.status,
    durationMs: entry.durationMs,
    errorCode: entry.errorCode
  };

  if (trace.collect) {
    const current = Array.isArray(context.meta.pluginTrace) ? context.meta.pluginTrace : [];
    context.meta.pluginTrace = [...current, event];
  }

  if (typeof trace.sink !== 'function') return;

  try {
    // Trace sinks are advisory and must not block or fail request execution.
    trace.sink(event);
  } catch {
    // Ignore sink failures to keep plugin behavior deterministic.
  }
}

/**
 * Execute a single plugin handler with timeout protection.
 * @param {{ name: string }} plugin - Plugin metadata.
 * @param {'transport' | 'schema' | 'before' | 'after' | 'error'} phase - Phase name.
 * @param {(context: Record<string, unknown>) => unknown} handler - Hook function.
 * @param {Record<string, unknown>} context - Mutable context.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @param {{ enabled: boolean, collect: boolean, sink?: (event: Record<string, unknown>) => void }} trace - Trace controls.
 * @returns {Promise<void>}
 */
async function runHandler(plugin, phase, handler, context, timeoutMs, trace) {
  let id;
  const startedAt = performance.now();

  /**
   * Resolve timeout rejection for a plugin phase.
   * @param {(_error: unknown) => void} reject - Promise rejection callback.
   * @returns {void}
   */
  function startTimer(reject) {
    id = setTimeout(function onTimeout() {
      reject(timeoutError(plugin.name, phase, timeoutMs));
    }, timeoutMs);
  }

  /**
   * Clear timeout resources.
   * @returns {void}
   */
  function stopTimer() {
    if (id) clearTimeout(id);
    id = undefined;
  }

  const task = Promise.resolve().then(function invoke() {
    return handler(context);
  });

  const timer = new Promise(function createTimer(_resolve, reject) {
    startTimer(reject);
  });

  try {
    const patch = await Promise.race([task, timer]);
    mergeContext(context, patch);
    emitTrace(trace, context, {
      plugin: plugin.name,
      phase,
      status: 'ok',
      durationMs: performance.now() - startedAt
    });
  } catch (error) {
    const blocked = blockedError(plugin.name, phase, error);
    emitTrace(trace, context, {
      plugin: plugin.name,
      phase,
      status: blocked instanceof LayerError && String(blocked.code ?? '') === 'PLUGIN_TIMEOUT' ? 'timeout' : 'error',
      durationMs: performance.now() - startedAt,
      errorCode: blocked instanceof LayerError && typeof blocked.code === 'string' ? blocked.code : undefined
    });
    throw blocked;
  } finally {
    stopTimer();
  }
}

/**
 * Register all hooks for a phase on a supply stack.
 * @param {any} stack - Supply stack instance.
 * @param {Array<{ name: string, transport?: (context: Record<string, unknown>) => unknown, schema?: (context: Record<string, unknown>) => unknown, before?: (context: Record<string, unknown>) => unknown, after?: (context: Record<string, unknown>) => unknown, error?: (context: Record<string, unknown>) => unknown }>} plugins - Plugin list.
 * @param {'transport' | 'schema' | 'before' | 'after' | 'error'} phase - Phase name.
 * @param {number} timeoutMs - Handler timeout.
 * @param {{ enabled: boolean, collect: boolean, sink?: (event: Record<string, unknown>) => void }} trace - Trace controls.
 * @returns {void}
 */
function register(stack, plugins, phase, timeoutMs, trace) {
  for (const plugin of plugins) {
    const hook = plugin[phase];
    if (typeof hook !== 'function') continue;

    /**
     * Execute a plugin layer and pass control to supply.
     * @param {Record<string, unknown>} context - Pipeline context.
     * @param {(error?: unknown) => void} next - Supply continuation callback.
     * @returns {void}
     */
    function layer(context, next) {
      runHandler(plugin, phase, hook, context, timeoutMs, trace)
        .then(function done() {
          next();
        })
        .catch(function failed(error) {
          next(error);
        });
    }

    stack.use(plugin.name, layer);
  }
}

/**
 * Execute a phase stack.
 * @param {any} stack - Supply stack instance.
 * @param {Record<string, unknown>} context - Mutable context.
 * @returns {Promise<void>}
 */
function runPhase(stack, context) {
  return new Promise(function exec(resolve, reject) {
    /**
     * Final callback from supply iteration.
     * @param {unknown} error - Optional phase error.
     * @returns {void}
     */
    function done(error) {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    }

    stack.each(context, done);
  });
}

/**
 * Normalize phase input context.
 * @param {Record<string, unknown>} input - Incoming phase context.
 * @returns {Record<string, unknown>}
 */
function normalizeContext(input) {
  const context = isRecord(input) ? { ...input } : {};

  context.operationId = typeof context.operationId === 'string' && context.operationId.length > 0
    ? context.operationId
    : randomUUID();

  if (!isRecord(context.meta)) context.meta = {};

  return context;
}

/**
 * Ensure a phase pipeline exists.
 * @param {unknown} pipeline - Candidate pipeline object.
 * @returns {asserts pipeline is { transport: any, schema: any, before: any, after: any, error: any }}
 */
function assertPipeline(pipeline) {
  if (!pipeline || typeof pipeline !== 'object') {
    throw new LayerError({
      name: 'plugin',
      method: 'runPipeline',
      message: 'Pipeline instance is required.',
      code: 'PLUGIN_INVALID'
    });
  }
}

/**
 * Build a plugin pipeline instance.
 * @param {{ plugins?: Array<Record<string, unknown>>, timeoutMs?: number, trace?: { enabled?: boolean, collect?: boolean, sink?: (event: Record<string, unknown>) => void } }} [input] - Pipeline options.
 * @returns {{ plugins: Array<{ name: string, transport?: (context: Record<string, unknown>) => unknown, schema?: (context: Record<string, unknown>) => unknown, before?: (context: Record<string, unknown>) => unknown, after?: (context: Record<string, unknown>) => unknown, error?: (context: Record<string, unknown>) => unknown }>, timeoutMs: number, trace: { enabled: boolean, collect: boolean, sink?: (event: Record<string, unknown>) => void }, transport: any, schema: any, before: any, after: any, error: any }}
 */
export function createPipeline(input = {}) {
  const timeoutMs = typeof input.timeoutMs === 'number' && input.timeoutMs > 0
    ? input.timeoutMs
    : DEFAULT_TIMEOUT_MS;
  const traceInput = isRecord(input.trace) ? input.trace : {};
  const tracing = {
    enabled: traceEnabled(traceInput.enabled),
    collect: traceInput.collect === undefined ? traceEnabled(traceInput.enabled) : Boolean(traceInput.collect),
    sink: typeof traceInput.sink === 'function' ? traceInput.sink : undefined
  };

  if (tracing.enabled && !tracing.sink && TRACE_DEBUG.test(String(process.env.MCP_LAYER_DEBUG ?? ''))) {
    tracing.sink = traceWrite;
  }

  const list = Array.isArray(input.plugins)
    ? input.plugins.map(definePlugin)
    : [];

  const stacks = {
    transport: new Supply(),
    schema: new Supply(),
    before: new Supply(),
    after: new Supply(),
    error: new Supply()
  };

  for (const phase of HOOKS) {
    register(stacks[phase], list, phase, timeoutMs, tracing);
  }

  return {
    plugins: list,
    timeoutMs,
    trace: tracing,
    transport: stacks.transport,
    schema: stacks.schema,
    before: stacks.before,
    after: stacks.after,
    error: stacks.error
  };
}

/**
 * Run transport phase hooks.
 * @param {{ transport: any }} pipeline - Pipeline bundle.
 * @param {Record<string, unknown>} input - Transport context.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runTransport(pipeline, input) {
  assertPipeline(pipeline);
  const context = normalizeContext(input);
  await runPhase(pipeline.transport, context);
  return context;
}

/**
 * Run schema phase hooks.
 * @param {{ schema: any }} pipeline - Pipeline bundle.
 * @param {Record<string, unknown>} input - Schema context.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runSchema(pipeline, input) {
  assertPipeline(pipeline);
  const context = normalizeContext(input);
  await runPhase(pipeline.schema, context);
  return context;
}

/**
 * Run an operation pipeline around an executor.
 * @param {{ before: any, after: any, error: any }} pipeline - Pipeline bundle.
 * @param {Record<string, unknown>} input - Operation context.
 * @param {(context: Record<string, unknown>) => Promise<unknown>} execute - Core execution callback.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function runPipeline(pipeline, input, execute) {
  assertPipeline(pipeline);

  if (typeof execute !== 'function') {
    throw new LayerError({
      name: 'plugin',
      method: 'runPipeline',
      message: 'Pipeline execute callback is required.',
      code: 'PLUGIN_INVALID'
    });
  }

  const context = normalizeContext(input);

  await runPhase(pipeline.before, context);

  try {
    context.result = await execute(context);
    await runPhase(pipeline.after, context);
    return context;
  } catch (error) {
    context.error = error;
    await runPhase(pipeline.error, context);
    throw context.error;
  }
}
