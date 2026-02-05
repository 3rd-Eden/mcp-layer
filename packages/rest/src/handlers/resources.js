import { executeWithBreaker } from '../resilience/breaker.js';
import { createCallContext, mapMcpError } from './common.js';
import { createValidationErrorResponse } from '../errors/mapping.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const templateLib = require('uri-template');

/**
 * Build a shared resource read handler.
 *
 * Why this exists: resource and template routes share the same MCP call flow.
 *
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @param {import('opossum') | null} breaker - Circuit breaker.
 * @param {ReturnType<import('../telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {{ exposeDetails: boolean }} errors - Error exposure configuration.
 * @param {(request: import('fastify').FastifyRequest) => { uri?: string, errors?: Array<{ path: string, keyword?: string, message?: string }> }} resolve - URI resolver.
 * @param {string} handlerName - Handler name for diagnostics.
 * @returns {import('fastify').RouteHandlerMethod}
 */
function createReadHandler(session, breaker, telemetry, errors, resolve, handlerName) {
  /**
   * Handle a resource read request.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @param {import('fastify').FastifyReply} reply - Fastify reply.
   * @returns {Promise<void>}
   */
  async function handleRead(request, reply) {
    const requestId = request.id;
    const instance = request.url;
    const resolved = resolve(request);

    if (resolved.errors && resolved.errors.length > 0) {
      const response = createValidationErrorResponse(instance, resolved.errors, requestId);
      reply.code(response.status).send(response);
      return;
    }

    if (!resolved.uri) {
      const response = createValidationErrorResponse(instance, [{ path: 'params', message: 'Resource URI could not be resolved.' }], requestId);
      reply.code(response.status).send(response);
      return;
    }

    const uri = resolved.uri;
    const ctx = createCallContext({
      telemetry,
      spanName: 'mcp.resources/read',
      attributes: {
        'mcp.resource.uri': uri,
        'mcp.session.name': session.name,
        'http.request.id': requestId
      },
      labels: { resource: uri, session: session.name }
    });

    try {
      const result = await executeWithBreaker(breaker, session, 'resources/read', { uri });

      ctx.recordSuccess();

      const list = result && Array.isArray(result.contents) ? result.contents : [];
      const item = list.length > 0 ? list[0] : null;
      if (item && typeof item.text === 'string') {
        if (item.mimeType) {
          reply.type(item.mimeType);
        }
        reply.code(200).send(item.text);
        return;
      }

      reply.code(200).send(result);
    } catch (error) {
      ctx.recordError(error);
      const response = mapMcpError(error, instance, requestId, errors);
      reply.code(response.status).send(response.body);
    } finally {
      ctx.finish();
    }
  }

  Object.defineProperty(handleRead, 'name', { value: handlerName });
  return handleRead;
}

/**
 * Create a handler for resource reads.
 *
 * Why this exists: maps HTTP GET requests to MCP resource reads.
 *
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @param {string} uri - Resource URI.
 * @param {import('opossum') | null} breaker - Circuit breaker.
 * @param {ReturnType<import('../telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {{ exposeDetails: boolean }} errors - Error exposure configuration.
 * @returns {import('fastify').RouteHandlerMethod}
 */
export function createResourceHandler(session, uri, breaker, telemetry, errors) {
  /**
   * Resolve a fixed resource URI.
   * @param {import('fastify').FastifyRequest} _request - Fastify request.
   * @returns {{ uri: string }}
   */
  function resolveResource(_request) {
    return { uri };
  }

  return createReadHandler(
    session,
    breaker,
    telemetry,
    errors,
    resolveResource,
    `handleResourceRead_${encodeURIComponent(uri)}`
  );
}

/**
 * Create a handler for resource template reads.
 *
 * Why this exists: template routes must expand variables into concrete URIs
 * before issuing a resource read.
 *
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @param {string} template - Resource URI template.
 * @param {{ maxTemplateParamLength: number }} validation - Validation limits.
 * @param {import('opossum') | null} breaker - Circuit breaker.
 * @param {ReturnType<import('../telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {{ exposeDetails: boolean }} errors - Error exposure configuration.
 * @returns {import('fastify').RouteHandlerMethod}
 */
export function createTemplateHandler(session, template, validation, breaker, telemetry, errors) {
  const parsed = templateLib.parse(template);

  /**
   * Expand route params into a concrete resource URI.
   * @param {Record<string, unknown>} params - Fastify params.
   * @returns {string}
   */
  function expandUri(params) {
    return parsed.expand(params ?? {});
  }

  /**
   * Validate template parameters.
   *
   * Why this exists: long path segments can be abused to create oversized
   * URIs and downstream load.
   *
   * @param {Record<string, unknown>} params - Route params.
   * @returns {Array<{ path: string, message: string }>}
   */
  function validateTemplateParams(params) {
    const errors = [];
    const max = validation.maxTemplateParamLength;

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) {
        continue;
      }
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
   * Resolve a template URI from request params.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @returns {{ uri?: string, errors?: Array<{ path: string, message: string }> }}
   */
  function resolveTemplate(request) {
    const params = request.params && typeof request.params === 'object' ? request.params : {};
    const paramErrors = validateTemplateParams(params);
    if (paramErrors.length > 0) {
      return { errors: paramErrors };
    }

    return { uri: expandUri(params) };
  }

  return createReadHandler(
    session,
    breaker,
    telemetry,
    errors,
    resolveTemplate,
    `handleTemplateRead_${encodeURIComponent(template)}`
  );
}
