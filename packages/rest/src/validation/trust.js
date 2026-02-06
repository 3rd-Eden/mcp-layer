/**
 * Determine whether schemas from a session should be trusted.
 *
 *
 * @param {import('@mcp-layer/session').Session} session - MCP session to evaluate.
 * @param {'auto' | true | false} policy - Trust policy.
 * @returns {boolean}
 */
export function shouldTrustSchemas(session, policy) {
  if (policy === true) return true;
  if (policy === false) return false;

  const type = session?.transport?.constructor?.name;
  const remote = type === 'StreamableHTTPClientTransport';
  return !remote;
}
