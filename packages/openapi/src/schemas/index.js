/**
 * RFC 9457 Problem Details schema used across REST handlers.
 * @type {Record<string, unknown>}
 */
export const problemDetailsSchema = {
  $id: 'ProblemDetails',
  type: 'object',
  properties: {
    type: { type: 'string', format: 'uri' },
    title: { type: 'string' },
    status: { type: 'integer', minimum: 100, maximum: 599 },
    detail: { type: 'string' },
    instance: { type: 'string', format: 'uri' },
    mcpErrorCode: { type: 'integer' },
    errors: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          keyword: { type: 'string' },
          message: { type: 'string' }
        }
      }
    },
    requestId: { type: 'string' },
    tool: { type: 'string' },
    session: { type: 'string' },
    toolError: {
      type: 'object',
      properties: {
        content: { type: 'array', items: { type: 'object' } },
        isError: { type: 'boolean' }
      }
    }
  },
  required: ['type', 'title', 'status', 'detail']
};

/**
 * Tool call response schema used for tool handlers.
 * @type {Record<string, unknown>}
 */
export const toolResponseSchema = {
  $id: 'ToolResponse',
  type: 'object',
  properties: {
    content: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['text', 'image', 'resource'] },
          text: { type: 'string' },
          data: { type: 'string' },
          mimeType: { type: 'string' }
        },
        required: ['type']
      }
    },
    isError: { type: 'boolean', default: false }
  },
  required: ['content']
};

/**
 * Collection of shared schemas to register with Fastify.
 * @type {Record<string, Record<string, unknown>>}
 */
export const schemas = {
  ProblemDetails: problemDetailsSchema,
  ToolResponse: toolResponseSchema
};
