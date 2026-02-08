import fp from 'fastify-plugin';
import mercurius from 'mercurius';
import { GraphQLError } from 'graphql';
import { createRequire } from 'node:module';
import { LayerError } from '@mcp-layer/error';
import { createCallContext, createRuntime, executeWithBreaker } from '@mcp-layer/gateway';
import { schema as buildSchema } from './schema.js';
import { validateOptions } from './config/validate.js';

const require = createRequire(import.meta.url);
const templateLib = require('uri-template');

/**
 * Map JSON-RPC/MCP numeric errors to GraphQL extension codes.
 * @type {Record<number, { code: string, title: string }>}
 */
const MCP_ERROR_MAP = {
  [-32700]: { code: 'BAD_REQUEST', title: 'Parse Error' },
  [-32600]: { code: 'BAD_REQUEST', title: 'Invalid Request' },
  [-32601]: { code: 'NOT_FOUND', title: 'Method Not Found' },
  [-32602]: { code: 'BAD_USER_INPUT', title: 'Invalid Parameters' },
  [-32603]: { code: 'INTERNAL_SERVER_ERROR', title: 'Internal Error' },
  [-32000]: { code: 'INTERNAL_SERVER_ERROR', title: 'Server Error' },
  [-32001]: { code: 'TIMEOUT', title: 'Request Timeout' },
  [-32002]: { code: 'NOT_FOUND', title: 'Resource Not Found' }
};

/**
 * Ensure an input value is a plain object.
 * @param {unknown} value - Candidate value.
 * @returns {Record<string, unknown>}
 */
function asRecord(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return /** @type {Record<string, unknown>} */ (value);
  }

  return {};
}

/**
 * Normalize tool call payload for GraphQL response shape.
 * @param {Record<string, unknown> | null | undefined} value - Tool call payload.
 * @returns {{ content: unknown, isError: boolean, structuredContent?: unknown }}
 */
function toolPayload(value) {
  const payload = value && typeof value === 'object' ? value : {};
  return {
    content: Array.isArray(payload.content) ? payload.content : [],
    isError: false,
    structuredContent: payload.structuredContent
  };
}

/**
 * Normalize prompt payload for GraphQL response shape.
 * @param {Record<string, unknown> | null | undefined} value - Prompt payload.
 * @returns {{ messages: unknown, payload: unknown }}
 */
function promptPayload(value) {
  const payload = value && typeof value === 'object' ? value : {};
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  return {
    messages,
    payload
  };
}

/**
 * Normalize resource payload for GraphQL response shape.
 * @param {Record<string, unknown> | null | undefined} value - Resource payload.
 * @returns {{ contents: unknown, text?: string, mimeType?: string, payload: unknown }}
 */
function resourcePayload(value) {
  const payload = value && typeof value === 'object' ? value : {};
  const contents = Array.isArray(payload.contents) ? payload.contents : [];
  const first = contents.length > 0 ? contents[0] : null;

  return {
    contents,
    text: typeof first?.text === 'string' ? first.text : undefined,
    mimeType: typeof first?.mimeType === 'string' ? first.mimeType : undefined,
    payload
  };
}

/**
 * Validate template parameter value sizes.
 * @param {Record<string, unknown>} params - Parameter values.
 * @param {number} max - Maximum allowed parameter length.
 * @returns {Array<{ path: string, message: string }>}
 */
function validateTemplateParams(params, max) {
  const errors = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const text = typeof value === 'string' ? value : String(value);
    if (text.length > max) {
      errors.push({
        path: `params.${key}`,
        message: `Parameter exceeds maximum length of ${max}.`
      });
    }
  }

  return errors;
}

/**
 * Expand an RFC6570 URI template with argument values.
 * @param {string} template - URI template expression.
 * @param {Record<string, unknown>} values - Template variables.
 * @returns {string}
 */
function expandTemplate(template, values) {
  const parsed = templateLib.parse(template);
  return parsed.expand(values);
}

/**
 * Build a GraphiQL redirect path for a runtime prefix.
 * @param {string} prefix - Runtime route prefix.
 * @returns {string}
 */
function graphiqlRedirect(prefix) {
  const base = prefix === '/' ? '' : prefix.replace(/\/+$/, '');
  return `${base}/graphiql`;
}

/**
 * Create Mercurius context factory for a runtime session.
 * @param {{ session: import('@mcp-layer/session').Session, validator: import('@mcp-layer/gateway').SchemaValidator, telemetry: ReturnType<import('@mcp-layer/gateway').createTelemetry> | null, resolve: (request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>, normalize: (error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown }} runtime - Runtime context.
 * @param {{ validation: { maxTemplateParamLength: number }, errors: { exposeDetails: boolean } }} config - GraphQL plugin config.
 * @returns {(request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<{ request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, callTool: (name: string, input: Record<string, unknown>) => Promise<{ content: unknown, isError: boolean, structuredContent?: unknown }>, getPrompt: (name: string, input: Record<string, unknown>) => Promise<{ messages: unknown, payload: unknown }>, readResource: (uri: string) => Promise<{ contents: unknown, text?: string, mimeType?: string, payload: unknown }>, readTemplate: (template: string, params: Record<string, unknown>) => Promise<{ contents: unknown, text?: string, mimeType?: string, payload: unknown }> }>}
 */
function createContextFactory(runtime, config) {
  /**
   * Create context object for a GraphQL request.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @param {import('fastify').FastifyReply} reply - Fastify reply.
   * @returns {Promise<{ request: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, callTool: (name: string, input: Record<string, unknown>) => Promise<{ content: unknown, isError: boolean, structuredContent?: unknown }>, getPrompt: (name: string, input: Record<string, unknown>) => Promise<{ messages: unknown, payload: unknown }>, readResource: (uri: string) => Promise<{ contents: unknown, text?: string, mimeType?: string, payload: unknown }>, readTemplate: (template: string, params: Record<string, unknown>) => Promise<{ contents: unknown, text?: string, mimeType?: string, payload: unknown }> }>}
   */
  async function createContext(request, reply) {
    /**
     * Execute an MCP tool call.
     * @param {string} name - Tool name.
     * @param {Record<string, unknown>} input - Tool input.
     * @returns {Promise<{ content: unknown, isError: boolean, structuredContent?: unknown }>}
     */
    async function callTool(name, input) {
      const requestId = request.id;
      const instance = request.url;
      let trace;

      try {
        const args = asRecord(input);
        const check = runtime.validator.validate('tool', name, args);
        if (!check.valid) {
          throw new LayerError({
            name: 'graphql',
            method: 'callTool',
            message: 'Request payload failed schema validation.',
            code: 'GRAPHQL_VALIDATION',
            details: check.errors ?? [],
            instance,
            requestId
          });
        }

        const resolved = await runtime.resolve(request);

        trace = createCallContext({
          telemetry: runtime.telemetry,
          spanName: 'mcp.tools/call',
          attributes: {
            'mcp.tool.name': name,
            'mcp.session.name': resolved.session.name,
            'http.request.id': requestId
          },
          labels: { tool: name, session: resolved.session.name },
          validationLabels: { tool: name }
        });

        const result = await executeWithBreaker(resolved.breaker, resolved.session, 'tools/call', {
          name,
          arguments: args
        });

        if (result?.isError) {
          trace.recordStatus('tool_error', 'tool_error');
          throw new LayerError({
            name: 'graphql',
            method: 'callTool',
            message: 'Tool "{tool}" reported an error.',
            vars: { tool: name },
            code: 'GRAPHQL_TOOL',
            tool: name,
            session: resolved.session.name,
            result,
            instance,
            requestId
          });
        }

        trace.recordSuccess();
        return toolPayload(result);
      } catch (error) {
        const runtimeError = /** @type {Error & { code?: string | number, details?: unknown, result?: unknown, session?: unknown, tool?: unknown, package?: string, method?: string, sessionName?: string }} */ (error);
        if (runtimeError.code !== 'GRAPHQL_TOOL' && runtimeError.code !== 'GRAPHQL_VALIDATION') trace?.recordError(runtimeError);

        if (runtimeError.code === 'GRAPHQL_VALIDATION') {
          throw new GraphQLError('Request payload failed schema validation.', {
            extensions: {
              code: 'BAD_USER_INPUT',
              type: 'error-validation',
              instance,
              requestId,
              errors: Array.isArray(runtimeError.details) ? runtimeError.details : []
            }
          });
        }

        if (runtimeError.code === 'GRAPHQL_TOOL') {
          throw new GraphQLError(`Tool "${runtimeError.tool}" reported an error.`, {
            extensions: {
              code: 'TOOL_ERROR',
              type: 'error-tool',
              instance,
              requestId,
              tool: typeof runtimeError.tool === 'string' ? runtimeError.tool : 'unknown',
              session: typeof runtimeError.session === 'string' ? runtimeError.session : 'unknown',
              toolError: {
                content: Array.isArray(runtimeError.result?.content) ? runtimeError.result.content : [],
                isError: true
              }
            }
          });
        }

        const normalized = runtime.normalize(runtimeError, instance, requestId);
        if (normalized instanceof GraphQLError) {
          const extensions = normalized.extensions ? { ...normalized.extensions } : undefined;

          throw new GraphQLError(normalized.message, { extensions });
        }

        const isManagerIdentityError = runtimeError.name === 'LayerError'
          && runtimeError.package === '@mcp-layer/manager'
          && runtimeError.method === 'identity';

        const isAuthRequired = runtimeError.code === 'AUTH_REQUIRED'
          || (isManagerIdentityError && runtimeError.message.includes('Authorization header is required.'));
        const isAuthInvalid = runtimeError.code === 'AUTH_INVALID'
          || (isManagerIdentityError && runtimeError.message.includes('Authorization header must use '));

        if (isAuthRequired || isAuthInvalid) {
          throw new GraphQLError('Authorization failed.', {
            extensions: {
              code: 'UNAUTHENTICATED',
              type: 'error-auth',
              instance,
              requestId
            }
          });
        }

        if (runtimeError.code === 'CIRCUIT_OPEN') {
          throw new GraphQLError('Service temporarily unavailable.', {
            extensions: {
              code: 'SERVICE_UNAVAILABLE',
              type: 'error-circuit-open',
              instance,
              requestId,
              session: runtimeError.sessionName
            }
          });
        }

        const numericCode = typeof runtimeError.code === 'number' ? runtimeError.code : -32603;
        const mapped = MCP_ERROR_MAP[numericCode] ?? MCP_ERROR_MAP[-32603];
        const detail = config.errors.exposeDetails ? runtimeError.message : 'Upstream service error';

        throw new GraphQLError(detail, {
          extensions: {
            code: mapped.code,
            title: mapped.title,
            type: 'error-runtime',
            instance,
            requestId,
            mcpErrorCode: numericCode
          }
        });
      } finally {
        trace?.finish();
      }
    }

    /**
     * Execute an MCP prompt request.
     * @param {string} name - Prompt name.
     * @param {Record<string, unknown>} input - Prompt input.
     * @returns {Promise<{ messages: unknown, payload: unknown }>}
     */
    async function getPrompt(name, input) {
      const requestId = request.id;
      const instance = request.url;
      let trace;

      try {
        const args = asRecord(input);
        const check = runtime.validator.validate('prompt', name, args);
        if (!check.valid) {
          throw new LayerError({
            name: 'graphql',
            method: 'getPrompt',
            message: 'Request payload failed schema validation.',
            code: 'GRAPHQL_VALIDATION',
            details: check.errors ?? [],
            instance,
            requestId
          });
        }

        const resolved = await runtime.resolve(request);

        trace = createCallContext({
          telemetry: runtime.telemetry,
          spanName: 'mcp.prompts/get',
          attributes: {
            'mcp.prompt.name': name,
            'mcp.session.name': resolved.session.name,
            'http.request.id': requestId
          },
          labels: { prompt: name, session: resolved.session.name },
          validationLabels: { prompt: name }
        });

        const result = await executeWithBreaker(resolved.breaker, resolved.session, 'prompts/get', {
          name,
          arguments: args
        });

        trace.recordSuccess();
        return promptPayload(result);
      } catch (error) {
        const runtimeError = /** @type {Error & { code?: string | number, details?: unknown, package?: string, method?: string, sessionName?: string }} */ (error);
        if (runtimeError.code !== 'GRAPHQL_VALIDATION') trace?.recordError(runtimeError);

        if (runtimeError.code === 'GRAPHQL_VALIDATION') {
          throw new GraphQLError('Request payload failed schema validation.', {
            extensions: {
              code: 'BAD_USER_INPUT',
              type: 'error-validation',
              instance,
              requestId,
              errors: Array.isArray(runtimeError.details) ? runtimeError.details : []
            }
          });
        }

        const normalized = runtime.normalize(runtimeError, instance, requestId);
        if (normalized instanceof GraphQLError) {
          const extensions = normalized.extensions ? { ...normalized.extensions } : undefined;

          throw new GraphQLError(normalized.message, { extensions });
        }

        const isManagerIdentityError = runtimeError.name === 'LayerError'
          && runtimeError.package === '@mcp-layer/manager'
          && runtimeError.method === 'identity';

        const isAuthRequired = runtimeError.code === 'AUTH_REQUIRED'
          || (isManagerIdentityError && runtimeError.message.includes('Authorization header is required.'));
        const isAuthInvalid = runtimeError.code === 'AUTH_INVALID'
          || (isManagerIdentityError && runtimeError.message.includes('Authorization header must use '));

        if (isAuthRequired || isAuthInvalid) {
          throw new GraphQLError('Authorization failed.', {
            extensions: {
              code: 'UNAUTHENTICATED',
              type: 'error-auth',
              instance,
              requestId
            }
          });
        }

        if (runtimeError.code === 'CIRCUIT_OPEN') {
          throw new GraphQLError('Service temporarily unavailable.', {
            extensions: {
              code: 'SERVICE_UNAVAILABLE',
              type: 'error-circuit-open',
              instance,
              requestId,
              session: runtimeError.sessionName
            }
          });
        }

        const numericCode = typeof runtimeError.code === 'number' ? runtimeError.code : -32603;
        const mapped = MCP_ERROR_MAP[numericCode] ?? MCP_ERROR_MAP[-32603];
        const detail = config.errors.exposeDetails ? runtimeError.message : 'Upstream service error';

        throw new GraphQLError(detail, {
          extensions: {
            code: mapped.code,
            title: mapped.title,
            type: 'error-runtime',
            instance,
            requestId,
            mcpErrorCode: numericCode
          }
        });
      } finally {
        trace?.finish();
      }
    }

    /**
     * Execute an MCP resource read.
     * @param {string} uri - Resource uri.
     * @returns {Promise<{ contents: unknown, text?: string, mimeType?: string, payload: unknown }>}
     */
    async function readResource(uri) {
      const requestId = request.id;
      const instance = request.url;
      let trace;

      try {
        const resolved = await runtime.resolve(request);

        trace = createCallContext({
          telemetry: runtime.telemetry,
          spanName: 'mcp.resources/read',
          attributes: {
            'mcp.resource.uri': uri,
            'mcp.session.name': resolved.session.name,
            'http.request.id': requestId
          },
          labels: { resource: uri, session: resolved.session.name }
        });

        const result = await executeWithBreaker(resolved.breaker, resolved.session, 'resources/read', { uri });
        trace.recordSuccess();
        return resourcePayload(result);
      } catch (error) {
        const runtimeError = /** @type {Error & { code?: string | number, package?: string, method?: string, sessionName?: string }} */ (error);
        trace?.recordError(runtimeError);

        const normalized = runtime.normalize(runtimeError, instance, requestId);
        if (normalized instanceof GraphQLError) {
          const extensions = normalized.extensions ? { ...normalized.extensions } : undefined;

          throw new GraphQLError(normalized.message, { extensions });
        }

        const isManagerIdentityError = runtimeError.name === 'LayerError'
          && runtimeError.package === '@mcp-layer/manager'
          && runtimeError.method === 'identity';

        const isAuthRequired = runtimeError.code === 'AUTH_REQUIRED'
          || (isManagerIdentityError && runtimeError.message.includes('Authorization header is required.'));
        const isAuthInvalid = runtimeError.code === 'AUTH_INVALID'
          || (isManagerIdentityError && runtimeError.message.includes('Authorization header must use '));

        if (isAuthRequired || isAuthInvalid) {
          throw new GraphQLError('Authorization failed.', {
            extensions: {
              code: 'UNAUTHENTICATED',
              type: 'error-auth',
              instance,
              requestId
            }
          });
        }

        if (runtimeError.code === 'CIRCUIT_OPEN') {
          throw new GraphQLError('Service temporarily unavailable.', {
            extensions: {
              code: 'SERVICE_UNAVAILABLE',
              type: 'error-circuit-open',
              instance,
              requestId,
              session: runtimeError.sessionName
            }
          });
        }

        const numericCode = typeof runtimeError.code === 'number' ? runtimeError.code : -32603;
        const mapped = MCP_ERROR_MAP[numericCode] ?? MCP_ERROR_MAP[-32603];
        const detail = config.errors.exposeDetails ? runtimeError.message : 'Upstream service error';

        throw new GraphQLError(detail, {
          extensions: {
            code: mapped.code,
            title: mapped.title,
            type: 'error-runtime',
            instance,
            requestId,
            mcpErrorCode: numericCode
          }
        });
      } finally {
        trace?.finish();
      }
    }

    /**
     * Execute an MCP template read.
     * @param {string} template - URI template.
     * @param {Record<string, unknown>} params - Template parameters.
     * @returns {Promise<{ contents: unknown, text?: string, mimeType?: string, payload: unknown }>}
     */
    async function readTemplate(template, params) {
      const requestId = request.id;
      const instance = request.url;
      const values = asRecord(params);
      const errors = validateTemplateParams(values, config.validation.maxTemplateParamLength);

      if (errors.length > 0) {
        throw new GraphQLError('Request payload failed schema validation.', {
          extensions: {
            code: 'BAD_USER_INPUT',
            type: 'error-validation',
            instance,
            requestId,
            errors
          }
        });
      }

      const uri = expandTemplate(template, values);

      return readResource(uri);
    }

    return {
      request,
      reply,
      callTool,
      getPrompt,
      readResource,
      readTemplate
    };
  }

  return createContext;
}

/**
 * Register GraphQL routes for a runtime context.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {{ catalog: { items?: Array<Record<string, unknown>> }, prefix: string, session: import('@mcp-layer/session').Session, validator: import('@mcp-layer/gateway').SchemaValidator, telemetry: ReturnType<import('@mcp-layer/gateway').createTelemetry> | null, resolve: (request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>, normalize: (error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown }} runtime - Runtime context.
 * @param {{ endpoint: string, ide: { enabled: boolean, path: string }, operations: { generated: boolean, generic: boolean }, validation: { maxTemplateParamLength: number }, errors: { exposeDetails: boolean } }} config - Plugin config.
 * @returns {Promise<void>}
 */
async function registerContext(fastify, runtime, config) {
  const built = buildSchema(runtime.catalog, {
    operations: config.operations
  });

  const contextFactory = createContextFactory(runtime, config);
  const graphiql = config.ide.enabled;

  /**
   * Register scoped GraphQL endpoint.
   * @param {import('fastify').FastifyInstance} scoped - Scoped instance.
   * @returns {Promise<void>}
   */
  async function registerScoped(scoped) {
    const graphiqlPath = graphiqlRedirect(runtime.prefix);

    await scoped.register(mercurius, {
      schema: built.schema,
      path: config.endpoint,
      graphiql,
      context: contextFactory
    });

    if (config.ide.enabled && config.ide.path !== '/graphiql') {
      /**
       * Redirect custom IDE path to Mercurius default graphiql endpoint.
       * @param {import('fastify').FastifyRequest} request - Fastify request.
       * @param {import('fastify').FastifyReply} reply - Fastify reply.
       * @returns {Promise<void>}
       */
      async function ideAlias(request, reply) {
        reply.redirect(graphiqlPath);
      }

      scoped.get(config.ide.path, ideAlias);
    }
  }

  await fastify.register(registerScoped, { prefix: runtime.prefix });
}

/**
 * Fastify plugin that exposes MCP sessions as GraphQL endpoints.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {Record<string, unknown>} opts - Plugin options.
 * @returns {Promise<void>}
 */
async function mcpGraphqlPlugin(fastify, opts) {
  const config = validateOptions(opts);
  const runtime = await createRuntime(
    {
      ...config,
      telemetry: {
        ...config.telemetry,
        metricPrefix: 'graphql'
      }
    },
    {
      name: 'graphql',
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
   * Close runtime resources on plugin close.
   * @returns {Promise<void>}
   */
  async function onClose() {
    await runtime.close();
  }

  fastify.addHook('onClose', onClose);
}

const plugin = fp(mcpGraphqlPlugin, {
  fastify: '5.x',
  name: '@mcp-layer/graphql',
  decorators: { fastify: [] },
  dependencies: []
});

export default plugin;
export { plugin };
