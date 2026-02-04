import { ErrorCode, McpError, SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js';

/**
 * Configure basic resource subscriptions on the underlying server transport.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register subscription handlers on.
 * @param {{ isSubscribable: (uri: string) => boolean }} options - Subscription filters for allowed URIs.
 * @returns {{ notifyResourceUpdated: (uri: string) => Promise<void> }}
 */
export function registerResourceSubscriptions(server, options) {
  const subscribers = new Map();

  server.server.assertCanSetRequestHandler(SubscribeRequestSchema.shape.method.value);
  server.server.assertCanSetRequestHandler(UnsubscribeRequestSchema.shape.method.value);
  server.server.registerCapabilities({
    resources: {
      subscribe: true
    }
  });

  server.server.setRequestHandler(SubscribeRequestSchema, async (request, extra) => {
    const uri = request.params.uri;
    if (!options.isSubscribable(uri)) {
      throw new McpError(ErrorCode.InvalidParams, `Cannot subscribe to ${uri}`);
    }
    const sessionId = extra.sessionId ?? 'stdio';
    const existing = subscribers.get(sessionId) ?? new Set();
    existing.add(uri);
    subscribers.set(sessionId, existing);
    return {};
  });

  server.server.setRequestHandler(UnsubscribeRequestSchema, async (request, extra) => {
    const sessionId = extra.sessionId ?? 'stdio';
    if (!sessionId) {
      return {};
    }
    const set = subscribers.get(sessionId);
    if (set) {
      set.delete(request.params.uri);
      if (set.size === 0) {
        subscribers.delete(sessionId);
      }
    }
    return {};
  });

  server.server.onclose = () => {
    subscribers.clear();
  };

  /**
   * Notify subscribed clients that a resource has been updated.
   * @param {string} uri - Resource URI that changed.
   * @returns {Promise<void>}
   */
  async function notifyResourceUpdated(uri) {
    let hasAudience = false;
    for (const set of subscribers.values()) {
      if (set.has(uri)) {
        hasAudience = true;
        break;
      }
    }
    if (hasAudience) {
      await server.server.sendResourceUpdated({ uri });
    }
  }

  return { notifyResourceUpdated };
}
