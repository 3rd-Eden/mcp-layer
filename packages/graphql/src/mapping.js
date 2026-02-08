import { createMap } from '@mcp-layer/gateway';

/**
 * Build deterministic GraphQL mapping metadata from a catalog.
 * @param {{ items?: Array<Record<string, unknown>> }} catalog - Extracted catalog.
 * @param {Record<string, unknown>} [options] - Reserved for future mapping customization.
 * @returns {ReturnType<typeof createMap>}
 */
export function map(catalog, options = {}) {
  void options;
  return createMap(catalog);
}
