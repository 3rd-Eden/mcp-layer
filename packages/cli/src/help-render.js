import { palette } from './colors.js';

/**
 * Render a help header.
 * @param {{ name: string, version: string, description: string }} meta - CLI metadata for name/version/description.
 * @param {{ accent: string, subtle: string }} theme - Theme colors for header styling.
 * @param {boolean} colors - Whether to emit ANSI color output.
 * @returns {string}
 */
export function header(meta, theme, colors) {
  const color = palette(colors, theme);
  const name = meta.name && meta.version ? `${meta.name} v${meta.version}` : meta.name;
  const parts = [];
  if (name) {
    parts.push(color.title(name));
  }
  if (meta.description) {
    parts.push(meta.description);
  }
  return parts.join('\n');
}

/**
 * Render a section with a title and lines.
 * @param {string} title - Section title text.
 * @param {string[]} lines - Section body lines.
 * @param {{ accent: string, subtle: string }} theme - Theme colors for section styling.
 * @param {boolean} colors - Whether to emit ANSI color output.
 * @returns {string}
 */
export function section(title, lines, theme, colors) {
  const color = palette(colors, theme);
  const output = [];
  output.push(color.title(`${title}:`));
  for (const line of lines) {
    output.push(line);
  }
  return output.join('\n');
}

/**
 * Wrap text to a fixed width.
 * @param {string} text - Input string to wrap.
 * @param {number} width - Maximum line width before wrapping.
 * @param {string} indent - Prefix to apply to each wrapped line.
 * @returns {string[]}
 */
export function wrap(text, width, indent) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width && line) {
      lines.push(`${indent}${line}`);
      line = word;
      continue;
    }
    line = next;
  }
  if (line) {
    lines.push(`${indent}${line}`);
  }
  return lines;
}
