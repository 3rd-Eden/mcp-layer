import fp from 'fastify-plugin';
import { extract } from '@mcp-layer/schema';
import { spec, schemas } from '@mcp-layer/openapi';
import { createValidator } from './validation/validator.js';
import { createCircuitBreaker } from './resilience/breaker.js';
import { registerRoutes } from './routing/register.js';
import { validateOptions } from './config/validate.js';
import { deriveApiVersion } from './routing/version.js';
import { createTelemetry } from './telemetry/index.js';
import { LayerError } from '@mcp-layer/error';

/**
 * Normalize a session input into an array.
 * @param {import('@mcp-layer/session').Session | Array<import('@mcp-layer/session').Session>} session - Session or session list.
 * @returns {Array<import('@mcp-layer/session').Session>}
 */
function list(session) {
  return Array.isArray(session) ? session : [session];
}

/**
 * Derive a prefix for a session.
 * @param {string | ((version: string, info: Record<string, unknown> | undefined, name: string) => string) | undefined} prefix - Prefix option.
 * @param {string} version - API version.
 * @param {Record<string, unknown> | undefined} info - Server info.
 * @param {string} name - Session name.
 * @returns {string}
 */
function resolvePrefix(prefixOption, version, info, name) {
  if (typeof prefixOption === 'function') return prefixOption(version, info, name);
  if (typeof prefixOption === 'string') return prefixOption;
  return `/${version}`;
}

/**
 * Ensure a circuit breaker exists for a session.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @param {{ resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number } }} config - Plugin config.
 * @param {ReturnType<import('./telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @returns {import('opossum') | null}
 */
function ensureBreaker(fastify, session, config, telemetry) {
  if (!config.resilience.enabled) return null;

  const map = fastify.mcpBreakers;
  if (!map) {
    throw new LayerError({
      name: 'rest',
      method: 'ensureBreaker',
      message: 'mcpBreakers map is not initialized.',
    });
  }

  const existing = map.get(session.name);
  if (existing) return existing;

  const breaker = createCircuitBreaker(session, config.resilience);
  map.set(session.name, breaker);

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
 * Create a session resolver for request handlers.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {import('@mcp-layer/session').Session} session - Catalog session.
 * @param {{ manager?: { get: (request: import('fastify').FastifyRequest) => Promise<import('@mcp-layer/session').Session> }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number } }} config - Plugin config.
 * @param {ReturnType<import('./telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @returns {(request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>}
 */
function createResolver(fastify, session, config, telemetry) {
  /**
   * Resolve a session for a request.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @returns {Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>}
   */
  async function resolve(request) {
    // Manager-backed flows resolve session per request so auth/identity can
    // drive connection selection at request time.
    const target = config.manager ? await config.manager.get(request) : session;
    const breaker = ensureBreaker(fastify, target, config, telemetry);
    return { session: target, breaker };
  }

  return resolve;
}

/**
 * Register routes for a single session.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @param {{ manager?: { get: (request: import('fastify').FastifyRequest) => Promise<import('@mcp-layer/session').Session> }, prefix?: string | ((version: string, info: Record<string, unknown> | undefined, name: string) => string), validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled?: boolean, serviceName: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, exposeOpenAPI: boolean }} config - Plugin config.
 * @returns {Promise<void>}
 */
async function registerSession(fastify, session, config) {
  const catalog = await extract(session);
  const info = catalog.server?.info;
  const version = deriveApiVersion(info);
  const pref = resolvePrefix(config.prefix, version, info, session.name);

  const validator = createValidator(config.validation, session);
  const items = Array.isArray(catalog.items) ? catalog.items : [];

  for (const item of items) {
    if (item.type === 'tool' && item.name && item.detail?.input?.json) {
      validator.registerToolSchema(String(item.name), item.detail.input.json);
    }
    if (item.type === 'prompt' && item.name && item.detail?.input?.json) {
      validator.registerPromptSchema(String(item.name), item.detail.input.json);
    }
  }

  const telemetry = createTelemetry(config.telemetry);
  const resolve = createResolver(fastify, session, config, telemetry);

  const doc = spec(catalog, {
    prefix: pref,
    title: info?.name ? String(info.name) : 'REST API',
    version: info?.version ? String(info.version) : '1.0.0',
    maxNameLength: config.validation.maxToolNameLength
  });

  /**
   * Register scoped routes under a prefix.
   * @param {import('fastify').FastifyInstance} scoped - Scoped instance.
   * @returns {Promise<void>}
   */
  async function registerScoped(scoped) {
    for (const schema of Object.values(schemas)) {
      scoped.addSchema(schema);
    }

    await registerRoutes(scoped, {
      session,
      catalog,
      validator,
      resolve,
      telemetry,
      errors: config.errors,
      validation: config.validation
    });

    if (config.exposeOpenAPI) {
      // OpenAPI 3.1 standardizes /openapi.json; swagger.json is the legacy alias.
      /**
       * Serve the OpenAPI JSON document.
       * @param {import('fastify').FastifyRequest} request - Fastify request.
       * @param {import('fastify').FastifyReply} reply - Fastify reply.
       * @returns {Promise<void>}
       */
      async function openapiHandler(request, reply) {
        reply.code(200).send(doc);
      }

      scoped.get('/openapi.json', { schema: { hide: true } }, openapiHandler);
    }
  }

  await fastify.register(registerScoped, { prefix: pref });
}

/**
 * Fastify plugin that exposes MCP sessions as REST endpoints.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {Record<string, unknown>} opts - Plugin options.
 * @returns {Promise<void>}
 */
async function mcpRestPlugin(fastify, opts) {
  const config = validateOptions(opts);
  if (!fastify.mcpBreakers) fastify.decorate('mcpBreakers', new Map());
  // Catalog extraction is performed once from the provided session. When a
  // manager is present, runtime session selection happens inside handlers.
  const sessions = config.manager ? [config.session] : list(config.session);

  for (const session of sessions) {
    await registerSession(fastify, session, config);
  }

  /**
   * Clean up circuit breakers on server close.
   * @param {import('fastify').FastifyInstance} instance - Fastify instance.
   * @returns {Promise<void>}
   */
  async function onClose(instance) {
    const map = instance.mcpBreakers ? Array.from(instance.mcpBreakers.values()) : [];
    for (const breaker of map) {
      breaker.shutdown();
    }
    if (config.manager && typeof config.manager.close === 'function') await config.manager.close();
  }

  fastify.addHook('onClose', onClose);
}

const plugin = fp(mcpRestPlugin, {
  fastify: '5.x',
  name: '@mcp-layer/rest',
  decorators: { fastify: [] },
  dependencies: []
});

export default plugin;
export { plugin };
