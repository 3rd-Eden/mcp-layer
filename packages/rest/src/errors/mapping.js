import { ERROR_TYPES } from './types.js';

/**
 * MCP error code to HTTP mapping.
 * @type {Record<number, { status: number, type: string, title: string }>}
 */
export const MCP_ERROR_MAP = {
  [-32700]: { status: 400, type: ERROR_TYPES.PARSE, title: 'Parse Error' },
  [-32600]: { status: 400, type: ERROR_TYPES.VALIDATION, title: 'Invalid Request' },
  [-32601]: { status: 404, type: ERROR_TYPES.NOT_FOUND, title: 'Method Not Found' },
  [-32602]: { status: 400, type: ERROR_TYPES.INVALID_PARAMS, title: 'Invalid Parameters' },
  [-32603]: { status: 500, type: ERROR_TYPES.INTERNAL, title: 'Internal Error' },
  [-32000]: { status: 500, type: ERROR_TYPES.INTERNAL, title: 'Server Error' },
  [-32001]: { status: 504, type: ERROR_TYPES.TIMEOUT, title: 'Request Timeout' },
  [-32002]: { status: 404, type: ERROR_TYPES.NOT_FOUND, title: 'Resource Not Found' }
};

/**
 * Create RFC 9457 problem details for an MCP error.
 *
 *
 * @param {Error & { code?: number }} error - MCP error instance.
 * @param {string} instance - Request path.
 * @param {string} [requestId] - Request identifier.
 * @param {{ exposeDetails?: boolean }} [options] - Error detail options.
 * @returns {{ type: string, title: string, status: number, detail: string, instance: string, mcpErrorCode: number, requestId?: string }}
 */
export function createMcpErrorResponse(error, instance, requestId, options = {}) {
  const code = typeof error.code === 'number' ? error.code : -32603;
  const map = MCP_ERROR_MAP[code] ?? {
    status: 500,
    type: ERROR_TYPES.INTERNAL,
    title: 'Unknown Error'
  };

  const detail = options.exposeDetails ? error.message : 'Upstream service error';

  const out = {
    type: map.type,
    title: map.title,
    status: map.status,
    detail,
    instance,
    mcpErrorCode: code
  };

  if (requestId) out.requestId = requestId;

  return out;
}

/**
 * Create RFC 9457 validation error response.
 * @param {string} instance - Request path.
 * @param {Array<{ path: string, keyword?: string, message?: string }>} errors - Validation errors.
 * @param {string} [requestId] - Request identifier.
 * @returns {{ type: string, title: string, status: number, detail: string, instance: string, errors: Array<{ path: string, keyword?: string, message?: string }>, requestId?: string }}
 */
export function createValidationErrorResponse(instance, errors, requestId) {
  const out = {
    type: ERROR_TYPES.VALIDATION,
    title: 'Validation Error',
    status: 400,
    detail: 'Request body failed schema validation',
    instance,
    errors
  };

  if (requestId) out.requestId = requestId;

  return out;
}

/**
 * Create RFC 9457 circuit breaker response.
 * @param {string} instance - Request path.
 * @param {string} sessionName - Session name.
 * @param {string} [requestId] - Request identifier.
 * @returns {{ type: string, title: string, status: number, detail: string, instance: string, requestId?: string }}
 */
export function createCircuitOpenResponse(instance, sessionName, requestId) {
  const out = {
    type: ERROR_TYPES.CIRCUIT_OPEN,
    title: 'Service Unavailable',
    status: 503,
    detail: `Circuit breaker open for session "${sessionName}". Service is temporarily unavailable.`,
    instance
  };

  if (requestId) out.requestId = requestId;

  return out;
}

/**
 * Create RFC 9457 auth error response.
 * @param {string} instance - Request path.
 * @param {string} title - Error title.
 * @param {string} detail - Error detail.
 * @param {string} [requestId] - Request identifier.
 * @returns {{ type: string, title: string, status: number, detail: string, instance: string, requestId?: string }}
 */
export function createAuthResponse(instance, title, detail, requestId) {
  const out = {
    type: ERROR_TYPES.AUTH,
    title,
    status: 401,
    detail,
    instance
  };

  if (requestId) out.requestId = requestId;

  return out;
}

/**
 * Create RFC 9457 problem details for a tool execution error.
 *
 * should receive an error status while still getting the tool payload for debugging.
 *
 * @param {string} instance - Request path.
 * @param {string} tool - Tool name.
 * @param {string} sessionName - Session name.
 * @param {{ content: Array<Record<string, unknown>>, isError?: boolean }} result - Tool result payload.
 * @param {string} [requestId] - Request identifier.
 * @returns {{ type: string, title: string, status: number, detail: string, instance: string, tool: string, session: string, toolError: { content: Array<Record<string, unknown>>, isError: boolean }, requestId?: string }}
 */
export function createToolErrorResponse(instance, tool, sessionName, result, requestId) {
  const out = {
    type: ERROR_TYPES.TOOL_ERROR,
    title: 'Tool Error',
    status: 502,
    detail: `Tool "${tool}" reported an error.`,
    instance,
    tool,
    session: sessionName,
    toolError: {
      content: Array.isArray(result.content) ? result.content : [],
      isError: true
    }
  };

  if (requestId) out.requestId = requestId;

  return out;
}
