import traverse from 'json-schema-traverse';
import safeRegex from 'safe-regex2';

/**
 * Check a regex pattern for safety.
 *
 * Why this exists: delegate regex validation to a dedicated library rather than
 * maintaining our own pattern heuristics.
 *
 * @param {string} pattern - Regex pattern string.
 * @param {number} maxPatternLength - Maximum allowed pattern length.
 * @returns {{ safe: boolean, reason?: string }}
 */
function checkPattern(pattern, maxPatternLength) {
  if (pattern.length > maxPatternLength) {
    return { safe: false, reason: `Regex pattern exceeds maximum length of ${maxPatternLength}` };
  }

  if (!safeRegex(pattern)) {
    return { safe: false, reason: 'Schema contains potentially unsafe regex pattern' };
  }

  return { safe: true };
}

/**
 * Compute the maximum depth for a JSON Schema tree.
 *
 * Why this exists: rely on a traversal helper for consistent depth accounting.
 *
 * @param {Record<string, unknown>} schema - JSON Schema to traverse.
 * @returns {number}
 */
function maxdepth(schema) {
  let max = 0;
  const seen = new WeakMap();

  traverse(schema, function visit(node, _jsonPtr, _root, _parentJsonPtr, _parentKeyword, parentSchema) {
    if (!node || typeof node !== 'object') {
      return;
    }
    const parentDepth = parentSchema && seen.has(parentSchema) ? seen.get(parentSchema) : 0;
    const depth = parentSchema ? parentDepth + 1 : 0;
    seen.set(node, depth);
    if (depth > max) {
      max = depth;
    }
  });

  return max;
}

/**
 * Check a JSON Schema for safety constraints.
 *
 * Why this exists: schemas can be abused to exhaust CPU or memory.
 *
 * @param {Record<string, unknown>} schema - JSON Schema to inspect.
 * @param {{ maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number }} config - Safety limits.
 * @param {number} [depth=0] - Current recursion depth.
 * @returns {{ safe: boolean, reason?: string }}
 */
export function checkSchemaSafety(schema, config) {
  const depth = maxdepth(schema);
  if (depth > config.maxSchemaDepth) {
    return { safe: false, reason: `Schema exceeds maximum depth of ${config.maxSchemaDepth}` };
  }

  const size = JSON.stringify(schema).length;
  if (size > config.maxSchemaSize) {
    return { safe: false, reason: `Schema exceeds maximum size of ${config.maxSchemaSize} bytes` };
  }

  let patternError;
  traverse(schema, function visit(node) {
    if (patternError || !node || typeof node !== 'object') {
      return;
    }
    if (typeof node.pattern === 'string') {
      const check = checkPattern(node.pattern, config.maxPatternLength);
      if (!check.safe) {
        patternError = check.reason;
      }
    }
  });

  if (patternError) {
    return { safe: false, reason: patternError };
  }

  return { safe: true };
}
