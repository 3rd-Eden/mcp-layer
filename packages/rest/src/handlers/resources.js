import { executeWithBreaker } from '../resilience/breaker.js';
import { createCallContext, mapMcpError } from './common.js';
import { createValidationErrorResponse } from '../errors/mapping.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const templateLib = require('uri-template');

/**
 * Build a shared resource read handler.
 *
 *
 * @param {(request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>} resolveSession - Session resolver.
 * @param {ReturnType<import('../telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {(error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown} normalize - Error normalization helper.
 * @param {{ exposeDetails: boolean }} errors - Error exposure configuration.
 * @param {(request: import('fastify').FastifyRequest) => { uri?: string, errors?: Array<{ path: string, keyword?: string, message?: string }> }} resolveUri - URI resolver.
 * @returns {import('fastify').RouteHandlerMethod}
 */
function read(resolveSession, telemetry, normalize, errors, resolveUri) {
  /**
   * Handle a resource read request.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @param {import('fastify').FastifyReply} reply - Fastify reply.
   * @returns {Promise<void>}
   */
  async function call(request, reply) {
    const requestId = request.id;
    const instance = request.url;
    const resolved = resolveUri(request);

    if (resolved.errors?.length > 0) {
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
    let ctx;

    try {
      const resolvedSession = await resolveSession(request);
      const session = resolvedSession.session;
      const breaker = resolvedSession.breaker;

      ctx = createCallContext({
        telemetry,
        spanName: 'mcp.resources/read',
        attributes: {
          'mcp.resource.uri': uri,
          'mcp.session.name': session.name,
          'http.request.id': requestId
        },
        labels: { resource: uri, session: session.name }
      });

      const result = await executeWithBreaker(breaker, session, 'resources/read', { uri });

      ctx.recordSuccess();

      const list = Array.isArray(result?.contents) ? result.contents : [];
      const item = list.length > 0 ? list[0] : null;
      if (typeof item?.text === 'string') {
        if (item?.mimeType) reply.type(item.mimeType);
        reply.code(200).send(item.text);
        return;
      }

      reply.code(200).send(result);
    } catch (error) {
      ctx?.recordError(error);
      const mapped = normalize(error, instance, requestId);

      if (mapped && typeof mapped === 'object' && Object.hasOwn(mapped, 'status') && Object.hasOwn(mapped, 'body')) {
        const response = /** @type {{ status: number, body: Record<string, unknown> }} */ (mapped);
        reply.code(response.status).send(response.body);
        return;
      }

      const response = mapMcpError(error, instance, requestId, errors);
      reply.code(response.status).send(response.body);
    } finally {
      ctx?.finish();
    }
  }

  return call;
}

/**
 * Create a resource read handler.
 *
 *
 * @param {(request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>} resolve - Session resolver.
 * @param {string} uri - Resource URI.
 * @param {ReturnType<import('../telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {(error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown} normalize - Error normalization helper.
 * @param {{ exposeDetails: boolean }} errors - Error exposure configuration.
 * @returns {import('fastify').RouteHandlerMethod}
 */
export function resource(resolve, uri, telemetry, normalize, errors) {
  /**
   * Resolve a fixed resource URI.
   * @param {import('fastify').FastifyRequest} _request - Fastify request.
   * @returns {{ uri: string }}
   */
  function fixed(_request) {
    return { uri };
  }

  return read(resolve, telemetry, normalize, errors, fixed);
}

/**
 * Create a resource template read handler.
 *
 * before issuing a resource read.
 *
 * @param {(request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>} resolve - Session resolver.
 * @param {string} template - Resource URI template.
 * @param {{ maxTemplateParamLength: number }} validation - Validation limits.
 * @param {ReturnType<import('../telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {(error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown} normalize - Error normalization helper.
 * @param {{ exposeDetails: boolean }} errors - Error exposure configuration.
 * @returns {import('fastify').RouteHandlerMethod}
 */
export function template(resolve, template, validation, telemetry, normalize, errors) {
  const parsed = templateLib.parse(template);

  /**
   * Expand route params into a concrete resource URI.
   * @param {Record<string, unknown>} params - Fastify params.
   * @returns {string}
   */
  function expand(params) {
    return parsed.expand(params ?? {});
  }

  /**
   * Validate template parameters.
   *
   * URIs and downstream load.
   *
   * @param {Record<string, unknown>} params - Route params.
   * @returns {Array<{ path: string, message: string }>}
   */
  function check(params) {
    const errors = [];
    const max = validation.maxTemplateParamLength;

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
   * Resolve a template URI from request params.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @returns {{ uri?: string, errors?: Array<{ path: string, message: string }> }}
   */
  function route(request) {
    const params = request.params && typeof request.params === 'object' ? request.params : {};
    const paramErrors = check(params);
    if (paramErrors.length > 0) {
      return { errors: paramErrors };
    }

    return { uri: expand(params) };
  }

  return read(resolve, telemetry, normalize, errors, route);
}
