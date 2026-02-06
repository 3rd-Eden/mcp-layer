/**
 * Error type URIs.
 *
 * semantics stay documented and stable for consumers.
 *
 * @type {Record<string, string>}
 */
export const ERROR_TYPES = {
  VALIDATION: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-validation',
  NOT_FOUND: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-not-found',
  PARSE: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-parse',
  AUTH: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-auth',
  INVALID_PARAMS: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-invalid-params',
  TIMEOUT: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-timeout',
  CIRCUIT_OPEN: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-circuit-open',
  INTERNAL: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-internal',
  CONFLICT: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-conflict',
  TOOL_ERROR: 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/rest#error-tool'
};
