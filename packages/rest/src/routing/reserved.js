/**
 * Reserved tool path segments.
 * @type {Set<string>}
 */
export const RESERVED_PATHS = new Set([
  'prompts',
  'resource-templates',
  'openapi.json'
]);

/**
 * Allowed tool name pattern (URL-safe segment).
 * @type {RegExp}
 */
const TOOL_NAME_PATTERN = /^[a-z0-9._-]+$/i;

/**
 * Validate that a name is safe for use in a path segment.
 *
 *
 * @param {string} name - Tool name.
 * @param {{ maxToolNameLength?: number }} [limits] - Validation limits.
 * @returns {void}
 */
export function validateSegmentName(name, limits = {}) {
  if (typeof name !== 'string' || name.length === 0) throw new Error('Tool name must be a non-empty string.');

  const max = typeof limits.maxToolNameLength === 'number' ? limits.maxToolNameLength : null;
  if (max && name.length > max) {
    throw new Error(`Tool name "${name}" exceeds maximum length of ${max}.`);
  }

  if (!TOOL_NAME_PATTERN.test(name)) {
    throw new Error(`Tool name "${name}" must be URL-safe (letters, digits, ".", "_", "-").`);
  }
}

/**
 * Validate that a tool name does not conflict with reserved paths.
 *
 *
 * @param {string} name - Tool name.
 * @param {Set<string>} [extra] - Additional reserved paths (lowercase).
 * @param {{ maxToolNameLength?: number }} [limits] - Validation limits.
 * @returns {void}
 */
export function validateToolName(name, extra = new Set(), limits = {}) {
  validateSegmentName(name, limits);

  const lower = name.toLowerCase();
  if (RESERVED_PATHS.has(lower) || extra.has(lower)) {
    const list = new Set([...RESERVED_PATHS, ...extra]);
    throw new Error(
      `Tool name "${name}" conflicts with reserved path. Reserved paths: ${[...list].join(', ')}`
    );
  }
}
