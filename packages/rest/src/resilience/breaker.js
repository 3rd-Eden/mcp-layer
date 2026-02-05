import CircuitBreaker from 'opossum';

/**
 * Build MCP client request options from a breaker instance.
 *
 * Why this exists: the SDK defaults to a 60s timeout, which keeps timers alive
 * after breaker timeouts unless we pass through the configured timeout.
 *
 * @param {CircuitBreaker | null} breaker - Breaker instance or null.
 * @returns {import('@modelcontextprotocol/sdk/shared/protocol.js').RequestOptions | undefined}
 */
function requestOptions(breaker) {
  if (!breaker || !breaker.options || typeof breaker.options.timeout !== 'number') {
    return undefined;
  }
  return { timeout: breaker.options.timeout };
}

/**
 * Create a circuit breaker for an MCP session.
 *
 * Why this exists: prevents cascading failures when a server is unhealthy.
 *
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @param {{ timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }} config - Breaker configuration.
 * @returns {CircuitBreaker}
 */
export function createCircuitBreaker(session, config) {
  const breaker = new CircuitBreaker(
    async function call(task) {
      const options = task.options;
      if (task.method === 'tools/call') {
        return session.client.callTool(task.params, undefined, options);
      }
      if (task.method === 'prompts/get') {
        return session.client.getPrompt(task.params, options);
      }
      if (task.method === 'resources/read') {
        return session.client.readResource(task.params, options);
      }
      return session.client.request({ method: task.method, params: task.params }, undefined, options);
    },
    {
      timeout: config.timeout,
      errorThresholdPercentage: config.errorThresholdPercentage,
      resetTimeout: config.resetTimeout,
      volumeThreshold: config.volumeThreshold,
      name: `mcp-${session.name}`
    }
  );

  breaker.on('open', function onOpen() {
    if (session.log && typeof session.log.warn === 'function') {
      session.log.warn({ session: session.name }, 'Circuit breaker OPENED - failing fast');
    }
  });

  breaker.on('halfOpen', function onHalfOpen() {
    if (session.log && typeof session.log.info === 'function') {
      session.log.info({ session: session.name }, 'Circuit breaker HALF-OPEN - testing recovery');
    }
  });

  breaker.on('close', function onClose() {
    if (session.log && typeof session.log.info === 'function') {
      session.log.info({ session: session.name }, 'Circuit breaker CLOSED - normal operation');
    }
  });

  breaker.on('timeout', function onTimeout() {
    if (session.log && typeof session.log.warn === 'function') {
      session.log.warn({ session: session.name }, 'Circuit breaker request timed out');
    }
  });

  breaker.on('reject', function onReject() {
    if (session.log && typeof session.log.debug === 'function') {
      session.log.debug({ session: session.name }, 'Circuit breaker rejected request (open)');
    }
  });

  return breaker;
}

/**
 * Execute an MCP call through a circuit breaker if enabled.
 *
 * Why this exists: unify breaker logic for tool/prompt/resource handlers.
 *
 * @param {CircuitBreaker | null} breaker - Breaker instance or null if disabled.
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @param {string} method - MCP method name.
 * @param {Record<string, unknown>} params - MCP parameters.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function executeWithBreaker(breaker, session, method, params) {
  const options = requestOptions(breaker);
  if (!breaker) {
    if (method === 'tools/call') {
      return session.client.callTool(params);
    }
    if (method === 'prompts/get') {
      return session.client.getPrompt(params);
    }
    if (method === 'resources/read') {
      return session.client.readResource(params);
    }
    return session.client.request({ method, params });
  }

  if (breaker.opened) {
    const error = new Error('Circuit breaker is open');
    error.code = 'CIRCUIT_OPEN';
    error.sessionName = breaker.name.replace('mcp-', '');
    throw error;
  }

  return breaker.fire({ method, params, options });
}
