/**
 * Build a capability checker bound to the current server connection.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server instance to read client capabilities from.
 * @returns {(capability: 'sampling' | 'elicitation' | 'roots') => boolean}
 */
export function createCapabilityChecker(server) {
  /**
   * Determine whether the connected client declared the requested capability.
   * @param {'sampling' | 'elicitation' | 'roots'} capability - Capability name to check.
   * @returns {boolean}
   */
  function hasCapability(capability) {
    const caps = server.server.getClientCapabilities();
    return Boolean(caps && caps[capability]);
  }

  return hasCapability;
}
