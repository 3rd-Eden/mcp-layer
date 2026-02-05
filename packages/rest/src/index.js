import fp from 'fastify-plugin';
import { extract } from '@mcp-layer/schema';
import { spec, schemas } from '@mcp-layer/openapi';
import { createValidator } from './validation/validator.js';
import { createCircuitBreaker } from './resilience/breaker.js';
import { registerRoutes } from './routing/register.js';
import { validateOptions } from './config/validate.js';
import { deriveApiVersion } from './routing/version.js';
import { createTelemetry } from './telemetry/index.js';

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
  if (typeof prefixOption === 'function') {
    return prefixOption(version, info, name);
  }
  if (typeof prefixOption === 'string') {
    return prefixOption;
  }
  return `/${version}`;
}

/**
 * Register routes for a single session.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @param {{ prefix?: string | ((version: string, info: Record<string, unknown> | undefined, name: string) => string), validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled?: boolean, serviceName: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, exposeOpenAPI: boolean }} config - Plugin config.
 * @returns {Promise<void>}
 */
async function registerSession(fastify, session, config) {
  const catalog = await extract(session);
  const version = deriveApiVersion(catalog.server && catalog.server.info ? catalog.server.info : undefined);
  const pref = resolvePrefix(config.prefix, version, catalog.server ? catalog.server.info : undefined, session.name);

  const validator = createValidator(config.validation, session);
  const items = Array.isArray(catalog.items) ? catalog.items : [];

  for (const item of items) {
    if (item.type === 'tool' && item.name && item.detail && item.detail.input && item.detail.input.json) {
      validator.registerToolSchema(String(item.name), item.detail.input.json);
    }
    if (item.type === 'prompt' && item.name && item.detail && item.detail.input && item.detail.input.json) {
      validator.registerPromptSchema(String(item.name), item.detail.input.json);
    }
  }

  const breaker = config.resilience.enabled ? createCircuitBreaker(session, config.resilience) : null;

  if (!fastify.mcpBreakers) {
    fastify.decorate('mcpBreakers', new Map());
  }

  if (breaker) {
    fastify.mcpBreakers.set(session.name, breaker);
  }

  const telemetry = createTelemetry(config.telemetry);
  if (telemetry && breaker) {
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

  const doc = spec(catalog, {
    prefix: pref,
    title: catalog.server && catalog.server.info && catalog.server.info.name ? String(catalog.server.info.name) : 'REST API',
    version: catalog.server && catalog.server.info && catalog.server.info.version ? String(catalog.server.info.version) : '1.0.0',
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
      breaker,
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
  const sessions = list(config.session);

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
