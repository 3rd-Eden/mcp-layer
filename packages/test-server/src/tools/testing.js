import { z } from 'zod';

/**
 * Register a tool that always returns isError true.
 *
 * Why this exists: REST tests need a deterministic tool error path without
 * relying on custom servers.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerFailGracefully(server) {
  const inputSchema = { reason: z.string().optional() };

  /**
   * Return a tool error payload.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function failGracefullyTool() {
    return {
      content: [{ type: 'text', text: 'Something went wrong' }],
      isError: true
    };
  }

  return server.registerTool(
    'fail-gracefully',
    {
      title: 'Fail Gracefully',
      description: 'Always returns isError true for REST error handling tests.',
      inputSchema
    },
    failGracefullyTool
  );
}

/**
 * Register a tool that throws.
 *
 * Why this exists: REST tests need a deterministic exception path that
 * exercises JSON-RPC error mapping.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerCrash(server) {
  const inputSchema = { reason: z.string().optional() };

  /**
   * Throw a protocol-level error.
   * @throws {Error}
   */
  async function crashTool() {
    throw new Error('Protocol failure');
  }

  return server.registerTool(
    'crash',
    {
      title: 'Crash',
      description: 'Throws an error to simulate protocol failures.',
      inputSchema
    },
    crashTool
  );
}

/**
 * Register a tool that intentionally exceeds short timeouts.
 *
 * Why this exists: circuit breaker tests need a slow tool to trigger timeouts.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerSlow(server) {
  const inputSchema = { reason: z.string().optional() };

  /**
   * Resolve after a fixed delay.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function slowTool() {
    return new Promise(function wait(resolve) {
      const timer = setTimeout(function done() {
        resolve({ content: [{ type: 'text', text: 'late' }] });
      }, 50);
      timer.unref();
    });
  }

  return server.registerTool(
    'slow',
    {
      title: 'Slow',
      description: 'Delays to trigger timeout behavior in clients.',
      inputSchema
    },
    slowTool
  );
}

/**
 * Register a tool that fails once then succeeds.
 *
 * Why this exists: circuit breaker recovery tests need a deterministic
 * transition from failure to success.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerFlap(server) {
  const inputSchema = { reason: z.string().optional() };
  let count = 0;

  /**
   * Throw on the first call, then return success.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function flapTool() {
    count += 1;
    if (count === 1) {
      throw new Error('first failure');
    }
    return { content: [{ type: 'text', text: 'ok' }] };
  }

  return server.registerTool(
    'flap',
    {
      title: 'Flap',
      description: 'Fails once, then succeeds to exercise breaker recovery.',
      inputSchema
    },
    flapTool
  );
}
