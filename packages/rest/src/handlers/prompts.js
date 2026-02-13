import { createValidationErrorResponse } from '../errors/mapping.js';
import { createCallContext, mapMcpError } from './common.js';

/**
 * Create a prompt invocation handler.
 *
 *
 * @param {(request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>} resolve - Session resolver.
 * @param {(request: import('fastify').FastifyRequest, method: string, params: Record<string, unknown>, meta?: Record<string, unknown>, resolved?: { session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }) => Promise<Record<string, unknown>>} execute - Runtime execution function.
 * @param {string} name - Prompt name.
 * @param {import('../validation/validator.js').SchemaValidator} validator - Schema validator.
 * @param {ReturnType<import('../telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {(error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown} normalize - Error normalization helper.
 * @param {{ exposeDetails: boolean }} errors - Error exposure configuration.
 * @returns {import('fastify').RouteHandlerMethod}
 */
export function prompt(resolve, execute, name, validator, telemetry, normalize, errors) {
  /**
   * Handle prompt requests.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @param {import('fastify').FastifyReply} reply - Fastify reply.
   * @returns {Promise<void>}
   */
  async function call(request, reply) {
    const requestId = request.id;
    const instance = request.url;
    let ctx;

    try {
      const resolved = await resolve(request);
      const session = resolved.session;

      ctx = createCallContext({
        telemetry,
        spanName: 'mcp.prompts/get',
        attributes: {
          'mcp.prompt.name': name,
          'mcp.session.name': session.name,
          'http.request.id': requestId
        },
        labels: { prompt: name, session: session.name },
        validationLabels: { prompt: name }
      });

      const check = validator.validate('prompt', name, request.body);
      if (!check.valid) {
        ctx.recordValidation();
        const error = createValidationErrorResponse(instance, check.errors, requestId);
        reply.code(error.status).send(error);
        return;
      }

      const result = await execute(
        request,
        'prompts/get',
        { name, arguments: request.body },
        {
          surface: 'prompts',
          promptName: name,
          sessionId: session.name
        },
        resolved
      );

      ctx.recordSuccess();

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
