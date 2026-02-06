const DOCS = 'github.com/3rd-Eden/mcp-layer/tree/main/packages';
const SCOPE = '@mcp-layer';

/**
 * Replaces %s placeholders in a template string with provided arguments.
 * @param {string} template - Message template.
 * @param {Array<string | number>} args - Substitution values.
 * @returns {string}
 */
function replacePlaceholders(template, args) {
  let index = 0;
  return template.replace(/%s/g, function replace() {
    const arg = args[index++];
    return arg !== undefined ? String(arg) : '%s';
  });
}

/**
 * Generate a stable short hashtag from name, method, and message.
 * This mirrors Bento's algorithm so references remain deterministic.
 * @param {string} message - Combined identity string.
 * @returns {string}
 */
export function hashtag(message) {
  let i = 0;
  let hash = 0;
  for (; i < message.length; hash = message.charCodeAt(i++) + ((hash << 5) - hash));
  const color = Math.floor(Math.abs(((Math.sin(hash) * 10000) % 1) * 16777216)).toString(16);
  return (`#${Array(6 - color.length + 1).join('0')}${color}`).toUpperCase();
}

/**
 * Normalize a package name for display and docs path generation.
 * @param {{ name: string, scope: string }} input - Package context.
 * @returns {{ full: string, slug: string }}
 */
function pkg(input) {
  if (input.name.startsWith('@')) {
    const parts = input.name.split('/');
    return { full: input.name, slug: parts[1] || input.name.replace(/^@/, '') };
  }
  return { full: `${input.scope}/${input.name}`, slug: input.name };
}

/**
 * Resolve a docs URL for an error.
 * @param {{ name: string, method: string, message: string, docs: string, scope: string }} input - Error identity and docs config.
 * @returns {string}
 */
export function docs(input) {
  const tag = hashtag([input.name, input.method, input.message].join('-')).slice(1).toLowerCase();
  const base = input.docs.startsWith('http://') || input.docs.startsWith('https://') ? input.docs : `https://${input.docs}`;
  const meta = pkg({ name: input.name, scope: input.scope });
  return `${base}/${meta.slug}/README.md#error-${tag}`;
}

/**
 * @typedef {{ name: string, method: string, message: string, args?: Array<string | number>, docs?: string, scope?: string, cause?: unknown, [key: string]: unknown }} LayerErrorArgs
 */

/**
 * Custom mcp-layer error with deterministic docs references.
 */
export class LayerError extends Error {
  /**
   * Create an error.
   * @param {LayerErrorArgs} args - Error arguments.
   */
  constructor({ name, method, message, args = [], docs: docsBase = DOCS, scope = SCOPE, cause, ...data }) {
    const formatted = args.length > 0 ? replacePlaceholders(message, args) : message;
    const meta = pkg({ name, scope });
    const url = docs({ name, method, message, docs: docsBase, scope });
    const tag = hashtag([name, method, message].join('-'));

    super([`${meta.full}(${method}): ${formatted}`, '', `For more information visit: ${url}`].join('\n'), { cause });

    if (data) Object.assign(this, data);

    this.name = 'LayerError';
    this.package = meta.full;
    this.method = method;
    this.reference = tag;
    this.docs = url;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export { LayerError as MCPLayerError };
