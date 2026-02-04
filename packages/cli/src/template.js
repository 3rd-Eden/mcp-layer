/**
 * Render a template URI from args.
 * @param {string | undefined} template - URI template string containing `{var}` placeholders.
 * @param {Record<string, unknown>} args - Replacement values keyed by template variable name.
 * @returns {string}
 */
export function render(template, args) {
  if (!template) {
    throw new Error('Template URI is missing.');
  }
  /**
   * Replace a template variable with its value.
   * @param {string} match - Full regex match text.
   * @param {string} key - Variable name captured from the template.
   * @returns {string}
   */
  function substitute(match, key) {
    if (Object.hasOwn(args, key)) {
      return String(args[key]);
    }
    throw new Error(`Missing template parameter: ${key}`);
  }

  return template.replace(/\{([^}]+)\}/g, substitute);
}
