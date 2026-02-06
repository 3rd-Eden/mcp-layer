import { executeWithBreaker } from '../resilience/breaker.js';
import { createValidationErrorResponse, createToolErrorResponse } from '../errors/mapping.js';
import { createCallContext, mapMcpError } from './common.js';

/**
 * Create a handler for tool invocation.
 *
 *
 * @param {(request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>} resolve - Session resolver.
 * @param {string} name - Tool name.
 * @param {import('../validation/validator.js').SchemaValidator} validator - Schema validator.
 * @param {ReturnType<import('../telemetry/index.js').createTelemetry> | null} telemetry - Telemetry helper.
 * @param {{ exposeDetails: boolean }} errors - Error exposure configuration.
 * @returns {import('fastify').RouteHandlerMethod}
 */
export function createToolHandler(resolve, name, validator, telemetry, errors) {
  /**
   * Handle tool invocation requests.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @param {import('fastify').FastifyReply} reply - Fastify reply.
   * @returns {Promise<void>}
   */
  async function handleToolCall(request, reply) {
    const requestId = request.id;
    const instance = request.url;
    let ctx;

    try {
      const resolved = await resolve(request);
      const session = resolved.session;
      const breaker = resolved.breaker;

      ctx = createCallContext({
        telemetry,
        spanName: 'mcp.tools/call',
        attributes: {
          'mcp.tool.name': name,
          'mcp.session.name': session.name,
          'http.request.id': requestId
        },
        labels: { tool: name, session: session.name },
        validationLabels: { tool: name }
      });

      const check = validator.validate('tool', name, request.body);
      if (!check.valid) {
        ctx.recordValidation();
        const error = createValidationErrorResponse(instance, check.errors, requestId);
        reply.code(error.status).send(error);
        return;
      }

      const result = await executeWithBreaker(breaker, session, 'tools/call', {
        name,
        arguments: request.body
      });

      if (result?.isError) {
        ctx.recordStatus('tool_error', 'tool_error');

        const response = createToolErrorResponse(instance, name, session.name, result, requestId);
        reply.code(response.status).send(response);
        return;
      }

      ctx.recordSuccess();

      const payload = result && typeof result === 'object' ? result : { content: [] };
      reply.code(200).send({
        ...payload,
        isError: false
      });
    } catch (error) {
      ctx?.recordError(error);
      const response = mapMcpError(error, instance, requestId, errors);
      reply.code(response.status).send(response.body);
    } finally {
      ctx?.finish();
    }
  }

  Object.defineProperty(handleToolCall, 'name', { value: `handleToolCall_${name}` });
  return handleToolCall;
}
