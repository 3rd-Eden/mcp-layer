import fp from 'fastify-plugin';
import { createRuntime } from '@mcp-layer/gateway';
import { spec, schemas } from '@mcp-layer/openapi';
import { registerRoutes } from './routing/register.js';
import { validateOptions } from './config/validate.js';

/**
 * Register routes for a runtime context.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {{ session: import('@mcp-layer/session').Session, catalog: { server?: { info?: Record<string, unknown> }, items?: Array<Record<string, unknown>> }, info: Record<string, unknown> | undefined, prefix: string, validator: import('@mcp-layer/gateway').SchemaValidator, telemetry: ReturnType<import('@mcp-layer/gateway').createTelemetry> | null, resolve: (request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>, execute: (request: import('fastify').FastifyRequest, method: string, params: Record<string, unknown>, meta?: Record<string, unknown>, resolved?: { session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }) => Promise<Record<string, unknown>>, normalize: (error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown }} context - Runtime context.
 * @param {{ validation: { maxToolNameLength: number, maxTemplateParamLength: number }, errors: { exposeDetails: boolean }, exposeOpenAPI: boolean }} config - Plugin config.
 * @returns {Promise<void>}
 */
async function registerContext(fastify, context, config) {
  const doc = spec(context.catalog, {
    prefix: context.prefix,
    title: context.info?.name ? String(context.info.name) : 'REST API',
    version: context.info?.version ? String(context.info.version) : '1.0.0',
    maxNameLength: config.validation.maxToolNameLength
  });

  /**
   * Register scoped routes under a prefix.
   * @param {import('fastify').FastifyInstance} scoped - Scoped Fastify instance.
   * @returns {Promise<void>}
   */
  async function registerScoped(scoped) {
    for (const schema of Object.values(schemas)) {
      scoped.addSchema(schema);
    }

    await registerRoutes(scoped, {
      session: context.session,
      catalog: context.catalog,
      validator: context.validator,
      resolve: context.resolve,
      execute: context.execute,
      telemetry: context.telemetry,
      normalize: context.normalize,
      errors: config.errors,
      validation: config.validation
    });

    if (config.exposeOpenAPI) {
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

  await fastify.register(registerScoped, { prefix: context.prefix });
}

/**
 * Fastify plugin that exposes MCP sessions as REST endpoints.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {Record<string, unknown>} opts - Plugin options.
 * @returns {Promise<void>}
 */
async function mcpRestPlugin(fastify, opts) {
  const config = validateOptions(opts);

  const runtime = await createRuntime(
    {
      ...config,
      telemetry: {
        ...config.telemetry,
        metricPrefix: 'rest'
      }
    },
    {
      name: 'rest',
      serviceName: config.telemetry.serviceName
    }
  );

  if (!fastify.mcpBreakers) {
    fastify.decorate('mcpBreakers', runtime.breakers);
  } else {
    fastify.mcpBreakers = runtime.breakers;
  }

  for (const context of runtime.contexts) {
    await registerContext(fastify, context, config);
  }

  /**
   * Clean up runtime resources on server close.
   * @returns {Promise<void>}
   */
  async function onClose() {
    await runtime.close();
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
