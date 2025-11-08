/**
 * Build a capability checker bound to the current server connection.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @returns {(capability: 'sampling' | 'elicitation' | 'roots') => boolean}
 */
export function createCapabilityChecker(server) {
  /**
   * Determine whether the connected client declared the requested capability.
   * @param {'sampling' | 'elicitation' | 'roots'} capability
   * @returns {boolean}
   */
  function hasCapability(capability) {
    const caps = server.server.getClientCapabilities();
    return Boolean(caps && caps[capability]);
  }

  return hasCapability;
}
