import { LayerError } from '@mcp-layer/error';

/**
 * Render a template URI from args.
 * @param {string | undefined} template - URI template string containing `{var}` placeholders.
 * @param {Record<string, unknown>} args - Replacement values keyed by template variable name.
 * @returns {string}
 */
export function render(template, args) {
  if (!template) {
    throw new LayerError({
      name: 'cli',
      method: 'render',
      message: 'Template URI is missing.',
    });
  }
  /**
   * Replace a template variable with its value.
   * @param {string} match - Full regex match text.
   * @param {string} key - Variable name captured from the template.
   * @returns {string}
   */
  function substitute(match, key) {
    if (Object.hasOwn(args, key)) return String(args[key]);
    throw new LayerError({
      name: 'cli',
      method: 'render',
      message: 'Template parameter "{parameter}" is required but was not provided.',
      vars: { parameter: key }
    });
  }

  return template.replace(/\{([^}]+)\}/g, substitute);
}
