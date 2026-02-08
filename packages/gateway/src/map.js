const TYPES = ['tool', 'prompt', 'resource', 'resource-template'];

/**
 * Sanitize a raw value into a GraphQL-safe field base.
 * @param {string} type - Catalog item type.
 * @param {string} value - Raw field candidate.
 * @returns {string}
 */
function sanitize(type, value) {
  const raw = value.replace(/[^A-Za-z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  const fallback = raw.length > 0 ? raw : `${type}_item`;
  if (/^[A-Za-z_]/.test(fallback)) return fallback;
  return `${type}_${fallback}`;
}

/**
 * Create a deterministic unique field name.
 * @param {Set<string>} used - Used field names for the root type.
 * @param {string} base - Base field candidate.
 * @returns {string}
 */
function unique(used, base) {
  let next = base;
  let index = 2;

  while (used.has(next)) {
    next = `${base}_${index}`;
    index += 1;
  }

  used.add(next);
  return next;
}

/**
 * Build catalog entries for a specific type.
 * @param {Array<Record<string, unknown>>} list - Catalog items.
 * @param {string} type - Desired type.
 * @returns {Array<Record<string, unknown>>}
 */
function bytype(list, type) {
  const out = [];
  for (const item of list) {
    if (item && item.type === type) out.push(item);
  }
  return out;
}

/**
 * Sort entries in a stable deterministic way.
 * @param {Array<Record<string, unknown>>} list - Input list.
 * @returns {Array<Record<string, unknown>>}
 */
function sortstable(list) {
  return list
    .map(function wrap(item, index) {
      return { item, index };
    })
    .sort(function compare(a, b) {
      const left = typeof a.item.name === 'string' ? a.item.name : '';
      const right = typeof b.item.name === 'string' ? b.item.name : '';
      if (left < right) return -1;
      if (left > right) return 1;
      return a.index - b.index;
    })
    .map(function unwrap(entry) {
      return entry.item;
    });
}

/**
 * Create a deterministic catalog map for adapters.
 * @param {{ items?: Array<Record<string, unknown>> }} catalog - Extracted catalog.
 * @returns {{ tools: Array<Record<string, unknown>>, prompts: Array<Record<string, unknown>>, resources: Array<Record<string, unknown>>, templates: Array<Record<string, unknown>>, entries: Array<{ type: string, root: 'query' | 'mutation', name: string, field: string, item: Record<string, unknown> }>, byType: (type: string) => Array<Record<string, unknown>>, find: (type: string, name: string) => Record<string, unknown> | undefined, findField: (type: string, name: string) => string | undefined }}
 */
export function createMap(catalog = {}) {
  const items = Array.isArray(catalog.items) ? catalog.items : [];
  const tools = sortstable(bytype(items, 'tool'));
  const prompts = sortstable(bytype(items, 'prompt'));
  const resources = sortstable(bytype(items, 'resource'));
  const templates = sortstable(bytype(items, 'resource-template'));

  const usedMutation = new Set(['callTool', 'getPrompt']);
  const usedQuery = new Set(['catalog', 'readResource', 'readTemplate']);
  const entries = [];
  const lookup = new Map();
  const fields = new Map();

  /**
   * Register entry metadata for deterministic lookup.
   * @param {'query' | 'mutation'} root - GraphQL root type.
   * @param {string} type - Catalog item type.
   * @param {Record<string, unknown>} item - Catalog item.
   * @returns {void}
   */
  function add(root, type, item) {
    const name = typeof item.name === 'string' ? item.name : `${type}_item`;
    const base = sanitize(type, name);
    const field = root === 'mutation'
      ? unique(usedMutation, base)
      : unique(usedQuery, base);

    entries.push({ type, root, name, field, item });
    lookup.set(`${type}:${name}`, item);
    fields.set(`${type}:${name}`, field);
  }

  for (const item of tools) add('mutation', 'tool', item);
  for (const item of prompts) add('mutation', 'prompt', item);
  for (const item of resources) add('query', 'resource', item);
  for (const item of templates) add('query', 'resource-template', item);

  /**
   * Select items by a known catalog type.
   * @param {string} type - Catalog type.
   * @returns {Array<Record<string, unknown>>}
   */
  function selectByType(type) {
    if (type === 'tool') return tools;
    if (type === 'prompt') return prompts;
    if (type === 'resource') return resources;
    if (type === 'resource-template') return templates;
    return [];
  }

  /**
   * Find a catalog item by type and name.
   * @param {string} type - Catalog type.
   * @param {string} name - Item name.
   * @returns {Record<string, unknown> | undefined}
   */
  function find(type, name) {
    return lookup.get(`${type}:${name}`);
  }

  /**
   * Find a generated GraphQL field by type and item name.
   * @param {string} type - Catalog type.
   * @param {string} name - Item name.
   * @returns {string | undefined}
   */
  function findField(type, name) {
    return fields.get(`${type}:${name}`);
  }

  return {
    tools,
    prompts,
    resources,
    templates,
    entries,
    byType: selectByType,
    find,
    findField
  };
}

export { TYPES };
