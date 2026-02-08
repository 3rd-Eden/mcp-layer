/**
 * Derive an API version prefix from MCP server info.
 * @param {{ version?: string } | undefined} info - MCP server info object.
 * @returns {string}
 */
export function deriveApiVersion(info) {
  if (!info || !info.version) return 'v0';

  const version = String(info.version).replace(/^v/, '');
  const semver = version.match(/^(\d+)/);
  if (semver) return `v${semver[1]}`;

  const date = version.match(/^(\d{4})-/);
  if (date) return `v${date[1]}`;

  return 'v0';
}

/**
 * Resolve a route prefix for a runtime context.
 * @param {string | ((version: string, info: Record<string, unknown> | undefined, name: string) => string) | undefined} prefixOption - Prefix option.
 * @param {string} version - API version.
 * @param {Record<string, unknown> | undefined} info - Server info.
 * @param {string} name - Session name.
 * @returns {string}
 */
export function resolvePrefix(prefixOption, version, info, name) {
  if (typeof prefixOption === 'function') return prefixOption(version, info, name);
  if (typeof prefixOption === 'string') return prefixOption;
  return `/${version}`;
}
