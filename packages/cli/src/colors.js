/**
 * Convert hex color to ANSI 24-bit escape sequence.
 * @param {string} hex
 * @param {string} text
 * @returns {string}
 */
function hexcolor(hex, text) {
  const match = /^#?([a-fA-F0-9]{6})$/.exec(hex);
  if (!match) {
    return text;
  }
  const value = match[1];
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${text}\x1b[0m`;
}

/**
 * Detect whether color output should be used.
 * @param {boolean} enabled
 * @returns {boolean}
 */
export function usecolors(enabled) {
  if (!enabled) {
    return false;
  }
  if (process.env.NO_COLOR) {
    return false;
  }
  return process.stdout.isTTY;
}

/**
 * Build color helpers for CLI output.
 * @param {boolean} enabled
 * @param {{ accent: string, subtle: string }} theme
 * @returns {{ title: (text: string) => string, name: (text: string) => string, flag: (text: string) => string, subtle: (text: string) => string }}
 */
export function palette(enabled, theme) {
  if (!usecolors(enabled)) {
    return {
      title: function title(text) {
        return text;
      },
      name: function name(text) {
        return text;
      },
      flag: function flag(text) {
        return text;
      },
      subtle: function subtle(text) {
        return text;
      }
    };
  }
  const accent = typeof theme.accent === 'string' ? theme.accent : '#FFA500';
  const subtle = typeof theme.subtle === 'string' ? theme.subtle : '#696969';
  return {
    title: function title(text) {
      return hexcolor(accent, text);
    },
    name: function name(text) {
      return text;
    },
    flag: function flag(text) {
      return hexcolor(subtle, text);
    },
    subtle: function subtle(text) {
      return hexcolor(subtle, text);
    }
  };
}
