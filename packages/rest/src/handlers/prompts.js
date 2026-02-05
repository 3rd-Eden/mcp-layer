import { executeWithBreaker } from '../resilience/breaker.js';
import { createValidationErrorResponse } from '../errors/mapping.js';
import { createCallContext, mapMcpError } from './common.js';

/**
 * Create a handler for prompt invocation.
 *
 * Why this exists: prompts share the same validation and breaker logic as tools.
 *
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @param {string} name - Prompt name.
 * @param {import('../validation/validator.js').SchemaValidator} validator - Schema validator.
 * @param {import('opossum') | null} breaker - Circuit breaker.
 * @param {ReturnType<import('../telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {{ exposeDetails: boolean }} errors - Error exposure configuration.
 * @returns {import('fastify').RouteHandlerMethod}
 */
export function createPromptHandler(session, name, validator, breaker, telemetry, errors) {
  /**
   * Handle prompt requests.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @param {import('fastify').FastifyReply} reply - Fastify reply.
   * @returns {Promise<void>}
   */
  async function handlePromptCall(request, reply) {
    const requestId = request.id;
    const instance = request.url;
    const ctx = createCallContext({
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

    try {
      const check = validator.validate('prompt', name, request.body);
      if (!check.valid) {
        ctx.recordValidation();
        const error = createValidationErrorResponse(instance, check.errors, requestId);
        reply.code(error.status).send(error);
        return;
      }

      const result = await executeWithBreaker(breaker, session, 'prompts/get', {
        name,
        arguments: request.body
      });

      ctx.recordSuccess();

      reply.code(200).send(result);
    } catch (error) {
      ctx.recordError(error);
      const response = mapMcpError(error, instance, requestId, errors);
      reply.code(response.status).send(response.body);
    } finally {
      ctx.finish();
    }
  }

  Object.defineProperty(handlePromptCall, 'name', { value: `handlePromptCall_${name}` });
  return handlePromptCall;
}
