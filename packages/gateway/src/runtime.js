import { extract } from '@mcp-layer/schema';
import { createGuardrails } from '@mcp-layer/guardrails';
import { createPipeline, runPipeline, runSchema, runTransport } from '@mcp-layer/plugin';
import { createValidator } from './validation/validator.js';
import { createCircuitBreaker, executeWithBreaker } from './resilience/breaker.js';
import { deriveApiVersion, resolvePrefix } from './version.js';
import { createTelemetry } from './telemetry/index.js';
import { validateRuntimeOptions } from './config/validate.js';

/**
 * Normalize a session input into an array.
 * @param {import('@mcp-layer/session').Session | Array<import('@mcp-layer/session').Session>} session - Session or session list.
 * @returns {Array<import('@mcp-layer/session').Session>}
 */
function list(session) {
  return Array.isArray(session) ? session : [session];
}

/**
 * Normalize a value into a plain object.
 * @param {unknown} value - Value to normalize.
 * @returns {Record<string, unknown>}
 */
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Register tool and prompt validators from a catalog.
 * @param {import('./validation/validator.js').SchemaValidator} validator - Schema validator.
 * @param {{ items?: Array<Record<string, unknown>> }} catalog - Extracted catalog.
 * @returns {void}
 */
function registerCatalogValidators(validator, catalog) {
  const items = Array.isArray(catalog.items) ? catalog.items : [];

  for (const item of items) {
    if (item.type === 'tool' && item.name && item.detail?.input?.json) {
      validator.registerToolSchema(String(item.name), item.detail.input.json);
    }

    if (item.type === 'prompt' && item.name && item.detail?.input?.json) {
      validator.registerPromptSchema(String(item.name), item.detail.input.json);
    }
  }
}

/**
 * Ensure a circuit breaker exists for a session.
 * @param {Map<string, import('opossum')>} breakers - Runtime breaker map.
 * @param {import('@mcp-layer/session').Session} session - Target session.
 * @param {{ enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }} config - Resilience config.
 * @param {ReturnType<import('./telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @returns {import('opossum') | null}
 */
function ensureBreaker(breakers, session, config, telemetry) {
  if (!config.enabled) return null;

  const existing = breakers.get(session.name);
  if (existing) return existing;

  const breaker = createCircuitBreaker(session, config);
  breakers.set(session.name, breaker);

  if (telemetry) {
    telemetry.setCircuitState(session.name, 'closed');
    breaker.on('open', function onOpen() {
      telemetry.setCircuitState(session.name, 'open');
    });
    breaker.on('halfOpen', function onHalfOpen() {
      telemetry.setCircuitState(session.name, 'half_open');
    });
    breaker.on('close', function onClose() {
      telemetry.setCircuitState(session.name, 'closed');
    });
  }

  return breaker;
}

/**
 * Resolve request-scoped session and breaker.
 * @param {import('@mcp-layer/session').Session} bootstrap - Bootstrap session.
 * @param {{ manager?: { get: (request: import('fastify').FastifyRequest) => Promise<import('@mcp-layer/session').Session> }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number } }} config - Runtime config.
 * @param {Map<string, import('opossum')>} breakers - Breaker storage.
 * @param {ReturnType<import('./telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {import('fastify').FastifyRequest} request - Incoming request.
 * @returns {Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>}
 */
async function resolveSession(bootstrap, config, breakers, telemetry, request) {
  const target = config.manager ? await config.manager.get(request) : bootstrap;
  const breaker = ensureBreaker(breakers, target, config.resilience, telemetry);
  return { session: target, breaker };
}

/**
 * Create shared runtime contexts for MCP adapters.
 * @param {Record<string, unknown>} opts - Runtime options.
 * @param {{ name?: string, serviceName?: string }} [meta] - Runtime metadata.
 * @returns {Promise<{ config: ReturnType<typeof validateRuntimeOptions>, contexts: Array<{ session: import('@mcp-layer/session').Session, catalog: { server?: { info?: Record<string, unknown> }, items?: Array<Record<string, unknown>> }, info: Record<string, unknown> | undefined, version: string, prefix: string, validator: import('./validation/validator.js').SchemaValidator, telemetry: ReturnType<typeof createTelemetry> | null, resolve: (request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>, execute: (request: import('fastify').FastifyRequest, method: string, params: Record<string, unknown>, meta?: Record<string, unknown>, resolved?: { session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }) => Promise<Record<string, unknown>>, normalize: (error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown }>, breakers: Map<string, import('opossum')>, normalize: (error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown, close: () => Promise<void> }>}
 */
export async function createRuntime(opts, meta = {}) {
  const config = validateRuntimeOptions(opts, meta);
  const sessions = config.manager ? [config.session] : list(config.session);
  const breakers = new Map();
  const contexts = [];
  const builtin = createGuardrails(config.guardrails);
  const custom = Array.isArray(config.plugins) ? config.plugins : [];
  const pipeline = createPipeline({
    plugins: [...builtin, ...custom],
    trace: config.pipeline?.trace
  });

  /**
   * Normalize adapter errors using configured mapper.
   * @param {Error & { code?: string | number }} error - Runtime error.
   * @param {string} instance - Request instance identifier.
   * @param {string} [requestId] - Request id.
   * @returns {unknown}
   */
  function normalize(error, instance, requestId) {
    if (config.normalizeError) {
      return config.normalizeError(error, instance, requestId, config.errors);
    }

    return {
      error,
      instance,
      requestId,
      options: config.errors
    };
  }

  for (const session of sessions) {
    const extracted = await extract(session);
    const shaped = await runSchema(pipeline, {
      surface: 'schema',
      method: 'schema/extract',
      sessionId: session.name,
      serverName: session.name,
      catalog: extracted,
      meta: {}
    });
    const catalog = record(shaped.catalog);
    const info = catalog.server?.info;
    const version = deriveApiVersion(info);
    const prefix = resolvePrefix(config.prefix, version, info, session.name);
    const validator = createValidator(config.validation, session);
    const telemetry = createTelemetry(config.telemetry);

    registerCatalogValidators(validator, catalog);

    /**
     * Resolve session context for a request.
     * @param {import('fastify').FastifyRequest} request - Incoming request.
     * @returns {Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>}
     */
    async function resolve(request) {
      return resolveSession(session, config, breakers, telemetry, request);
    }

    /**
     * Execute an MCP method with request-scoped session resolution.
     * @param {import('fastify').FastifyRequest} request - Incoming request.
     * @param {string} method - MCP method.
     * @param {Record<string, unknown>} params - MCP params.
     * @param {Record<string, unknown>} [meta] - Runtime metadata for pipeline hooks.
     * @param {{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }} [resolved] - Optional pre-resolved session context.
     * @returns {Promise<Record<string, unknown>>}
     */
    async function execute(request, method, params, meta = {}, resolved) {
      const selected = resolved
        && typeof resolved === 'object'
        && resolved.session
        ? resolved
        : await resolve(request);
      const transport = await runTransport(pipeline, {
        surface: String(method.split('/')[0] ?? 'unknown'),
        method,
        params: record(params),
        sessionId: selected.session.name,
        serverName: selected.session.name,
        session: selected.session,
        breaker: selected.breaker,
        meta: record(meta)
      });

      const state = await runPipeline(pipeline, transport, async function invoke(run) {
        const targetSession = run.session && typeof run.session === 'object'
          ? run.session
          : selected.session;
        const targetBreaker = Object.hasOwn(run, 'breaker')
          ? /** @type {import('opossum') | null} */ (run.breaker)
          : selected.breaker;
        const targetMethod = typeof run.method === 'string' ? run.method : method;
        const targetParams = record(run.params);

        return executeWithBreaker(targetBreaker, targetSession, targetMethod, targetParams);
      });

      return /** @type {Record<string, unknown>} */ (state.result);
    }

    /**
     * Normalize a runtime error.
     * @param {Error & { code?: string | number }} error - Runtime error.
     * @param {string} instance - Request instance identifier.
     * @param {string} [requestId] - Request id.
     * @returns {unknown}
     */
    function contextNormalize(error, instance, requestId) {
      return normalize(error, instance, requestId);
    }

    contexts.push({
      session,
      catalog,
      info,
      version,
      prefix,
      validator,
      telemetry,
      resolve,
      execute,
      normalize: contextNormalize
    });
  }

  /**
   * Close runtime resources.
   * @returns {Promise<void>}
   */
  async function close() {
    for (const breaker of breakers.values()) {
      breaker.shutdown();
    }

    if (config.manager && typeof config.manager.close === 'function') {
      await config.manager.close();
    }
  }

  return {
    config,
    contexts,
    breakers,
    normalize,
    close
  };
}
