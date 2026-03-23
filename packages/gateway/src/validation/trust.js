/**
 * Determine whether schemas from a session should be trusted.
 * Missing bootstrap sessions are treated conservatively because catalog-only
 * manager mode may be registering schemas sourced from a remote runtime.
 *
 * @param {import('@mcp-layer/session').Session | undefined} session - Optional MCP session to evaluate.
 * @param {'auto' | true | false} policy - Trust policy.
 * @returns {boolean}
 */
export function shouldTrustSchemas(session, policy) {
  if (policy === true) return true;
  if (policy === false) return false;
  if (!session) return false;

  const type = session?.transport?.constructor?.name;
  const remote = type === 'StreamableHTTPClientTransport';
  return !remote;
}
