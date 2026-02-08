import { createCallContext } from '@mcp-layer/gateway';
import { createAuthResponse, createCircuitOpenResponse, createMcpErrorResponse } from '../errors/mapping.js';

export { createCallContext };

/**
 * Map an MCP error to an HTTP response.
 * @param {Error & { code?: string | number, sessionName?: string }} error - Error from MCP call.
 * @param {string} instance - Request path.
 * @param {string} [requestId] - Request identifier.
 * @param {{ exposeDetails?: boolean }} [options] - Error detail options.
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
export function mapMcpError(error, instance, requestId, options) {
  if (error.code === 'CIRCUIT_OPEN') {
    const response = createCircuitOpenResponse(instance, error.sessionName, requestId);
    return { status: response.status, body: response };
  }

  const isManagerIdentityError = error && error.name === 'LayerError'
    && error.package === '@mcp-layer/manager'
    && error.method === 'identity';

  const isAuthRequired = error.code === 'AUTH_REQUIRED'
    || (isManagerIdentityError && error.message.includes('Authorization header is required.'));

  const isAuthInvalid = error.code === 'AUTH_INVALID'
    || (isManagerIdentityError && error.message.includes('Authorization header must use '));

  if (isAuthRequired) {
    const response = createAuthResponse(instance, 'Unauthorized', 'Authorization is required.', requestId);
    return { status: response.status, body: response };
  }

  if (isAuthInvalid) {
    const response = createAuthResponse(instance, 'Unauthorized', 'Authorization is invalid.', requestId);
    return { status: response.status, body: response };
  }

  const response = createMcpErrorResponse(error, instance, requestId, options);
  return { status: response.status, body: response };
}
