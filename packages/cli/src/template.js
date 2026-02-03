/**
 * Render a template URI from args.
 * @param {string | undefined} template
 * @param {Record<string, unknown>} args
 * @returns {string}
 */
export function render(template, args) {
  if (!template) {
    throw new Error('Template URI is missing.');
  }
  /**
   * Replace a template variable with its value.
   * @param {string} match
   * @param {string} key
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
