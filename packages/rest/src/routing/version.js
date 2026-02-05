/**
 * Derive an API version prefix from MCP server info.
 *
 * Why this exists: keep URLs stable across non-breaking changes.
 *
 * @param {{ version?: string } | undefined} info - MCP server info object.
 * @returns {string}
 */
export function deriveApiVersion(info) {
  if (!info || !info.version) {
    return 'v0';
  }

  const version = String(info.version).replace(/^v/, '');
  const semver = version.match(/^(\d+)/);
  if (semver) {
    return `v${semver[1]}`;
  }

  const date = version.match(/^(\d{4})-/);
  if (date) {
    return `v${date[1]}`;
  }

  return 'v0';
}
