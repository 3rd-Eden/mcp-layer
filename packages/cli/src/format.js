import terminalImage from 'terminal-image';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { palette } from './colors.js';

let markdownReady = false;

/**
 * Configure the markdown renderer once.
 * @returns {void}
 */
function setupmarkdown() {
  if (markdownReady) return;
  marked.use(markedTerminal());
  markdownReady = true;
}

/**
 * Determine if a text block looks like Markdown.
 * @param {string} text - Text content to inspect for Markdown-like syntax.
 * @param {string | undefined} mimeType - Optional explicit MIME type hint.
 * @returns {boolean}
 */
function ismarkdown(text, mimeType) {
  if (mimeType === 'text/markdown' || mimeType === 'text/md') return true;
  const sample = text.trim();
  return /^#{1,6}\s/.test(sample)
    || /```/.test(sample)
    || /\*\*[^*]+\*\*/.test(sample)
    || /^\s*-\s+/.test(sample)
    || /^\s*\d+\.\s+/.test(sample);
}

/**
 * Render a text block with optional Markdown formatting.
 * @param {string} text - Text content to render.
 * @param {{ markdown: boolean, tty: boolean, ansi: boolean }} options - Output flags controlling markdown/ANSI behavior.
 * @param {string | undefined} mimeType - Optional MIME type for markdown detection.
 * @returns {string[]}
 */
function rendertext(text, options, mimeType) {
  const safe = sanitize(text, options);
  if (options.markdown && options.tty && ismarkdown(safe, mimeType)) {
    setupmarkdown();
    const output = marked.parse(safe);
    return String(output).trimEnd().split('\n');
  }
  return String(safe).split('\n');
}

/**
 * Decode base64 data into a buffer.
 * @param {string} data - Base64-encoded payload.
 * @returns {Buffer}
 */
function decode(data) {
  return Buffer.from(data, 'base64');
}

/**
 * Format a byte size for display.
 * @param {number} size - Byte length to format.
 * @returns {string}
 */
function bytes(size) {
  if (size < 1024) {
    return `${size} bytes`;
  }
  const kb = size / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Strip ANSI escape sequences from text.
 * @param {string} text - Text that may contain ANSI sequences.
 * @returns {string}
 */
function stripansi(text) {
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\u0007]*\u0007/g, '');
}

/**
 * Sanitize text content unless ANSI is explicitly allowed.
 * @param {string} text - Text to sanitize for terminal-safe output.
 * @param {{ ansi: boolean }} options - Output flags controlling ANSI stripping.
 * @returns {string}
 */
function sanitize(text, options) {
  if (options.ansi) return text;
  return stripansi(text);
}
/**
 * Check if a content item is an image payload.
 * @param {Record<string, unknown>} item - Content item from an MCP response.
 * @returns {boolean}
 */
function isimage(item) {
  return item.type === 'image' && typeof item.data === 'string';
}

/**
 * Check if a content item is an audio payload.
 * @param {Record<string, unknown>} item - Content item from an MCP response.
 * @returns {boolean}
 */
function isaudio(item) {
  return item.type === 'audio' && typeof item.data === 'string';
}

/**
 * Check if a content item is a resource link.
 * @param {Record<string, unknown>} item - Content item from an MCP response.
 * @returns {boolean}
 */
function islink(item) {
  return item.type === 'resource_link' && typeof item.uri === 'string';
}

/**
 * Check if a content item is an embedded resource.
 * @param {Record<string, unknown>} item - Content item from an MCP response.
 * @returns {boolean}
 */
function isresource(item) {
  return item.type === 'resource' && typeof item.resource === 'object' && item.resource !== null;
}

/**
 * Check if a resource content entry is binary.
 * @param {Record<string, unknown>} item - Resource content entry with a possible blob field.
 * @returns {boolean}
 */
function isblob(item) {
  return typeof item.blob === 'string';
}

/**
 * Render a resource link entry.
 * @param {Record<string, unknown>} item - Resource link payload with name/uri/description metadata.
 * @param {{ title: (text: string) => string, subtle: (text: string) => string }} color - Color palette helpers.
 * @returns {string[]}
 */
function renderlink(item, color) {
  const name = typeof item.name === 'string' ? item.name : '';
  const desc = typeof item.description === 'string' ? item.description : '';
  const mime = typeof item.mimeType === 'string' ? item.mimeType : '';
  const uri = typeof item.uri === 'string' ? item.uri : '';
  const lines = [];
  const title = name ? `Resource link: ${name}` : 'Resource link';
  lines.push(color.title(`${title}:`));
  if (desc) {
    lines.push(`  ${desc}`);
  }
  if (mime) {
    lines.push(`  ${color.subtle(mime)}`);
  }
  if (uri) {
    lines.push(`  ${uri}`);
  }
  return lines;
}

/**
 * Render binary content as a textual hint.
 * @param {string} label - Human-readable label for the binary payload.
 * @param {string | undefined} mimeType - Optional MIME type for display.
 * @param {number} size - Byte length of the binary payload.
 * @param {{ subtle: (text: string) => string }} color - Color palette helpers.
 * @param {boolean} multi - Whether multiple payloads were returned in the response.
 * @returns {string[]}
 */
function renderbinary(label, mimeType, size, color, multi) {
  const mime = mimeType ? ` ${mimeType}` : '';
  const hint = multi ? 'Use --raw when a single binary payload is returned.' : 'Use --raw to pipe.';
  return [`${label}:${mime} ${color.subtle(`(${bytes(size)})`)} ${hint}`];
}

/**
 * Emit a buffer directly to stdout.
 * @param {Buffer} buffer - Binary data to write to stdout.
 * @returns {void}
 */
function writebuffer(buffer) {
  process.stdout.write(buffer);
}

/**
 * Emit a list of lines to stdout.
 * @param {string[]} lines - Preformatted output lines to write.
 * @returns {void}
 */
function writelines(lines) {
  if (lines.length === 0) return;
  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * Extract a single binary payload for raw output.
 * @param {Array<Record<string, unknown>>} items - MCP content items to inspect.
 * @returns {Buffer | null}
 */
function singlebinary(items) {
  if (items.length !== 1) return null;
  const item = items[0];
  if (isimage(item) || isaudio(item)) return decode(String(item.data));
  if (isresource(item) && item.resource && typeof item.resource === 'object') {
    const res = /** @type {Record<string, unknown>} */ (item.resource);
    if (typeof res.blob === 'string') return decode(res.blob);
  }
  return null;
}

/**
 * Extract a single binary resource content entry.
 * @param {Array<Record<string, unknown>>} items - Resource content entries to inspect.
 * @returns {Buffer | null}
 */
function singleblob(items) {
  if (items.length !== 1) return null;
  const item = items[0];
  if (isblob(item)) return decode(String(item.blob));
  return null;
}

/**
 * Extract a single text resource content entry.
 * @param {Array<Record<string, unknown>>} items - Resource content entries to inspect.
 * @returns {string | null}
 */
function singleresource(items) {
  if (items.length !== 1) return null;
  const item = items[0];
  if (typeof item.text === 'string') return item.text;
  return null;
}

/**
 * Format content array into CLI-friendly lines.
 * @param {Array<Record<string, unknown>>} items - MCP content array to render.
 * @param {{ raw: boolean, markdown: boolean, ansi: boolean, tty: boolean, colors: boolean, theme: { accent: string, subtle: string } }} options - Output flags and theme settings.
 * @returns {Promise<string[]>}
 */
async function rendercontent(items, options) {
  const color = palette(options.colors, options.theme);
  const lines = [];
  const multi = items.length > 1;

  for (const item of items) {
    if (item.type === 'text' && typeof item.text === 'string') {
      if (multi) lines.push(color.title('Text:'));
      const mime = typeof item.mimeType === 'string' ? item.mimeType : undefined;
      lines.push(...rendertext(item.text, options, mime));
      if (multi) lines.push('');
      continue;
    }

    if (isimage(item)) {
      const mime = typeof item.mimeType === 'string' ? item.mimeType : undefined;
      const data = decode(String(item.data));
      if (options.tty) {
        try {
          const output = await terminalImage.buffer(data);
          lines.push(...String(output).trimEnd().split('\n'));
        } catch {
          lines.push(...renderbinary('Image', mime, data.length, color, multi));
        }
      } else {
        lines.push(...renderbinary('Image', mime, data.length, color, multi));
      }
      lines.push('');
      continue;
    }

    if (isaudio(item)) {
      const mime = typeof item.mimeType === 'string' ? item.mimeType : undefined;
      const data = decode(String(item.data));
      lines.push(...renderbinary('Audio', mime, data.length, color, multi));
      lines.push('');
      continue;
    }

    if (islink(item)) {
      lines.push(...renderlink(item, color));
      lines.push('');
      continue;
    }

    if (isresource(item)) {
      const res = /** @type {Record<string, unknown>} */ (item.resource);
      const header = typeof res.uri === 'string' ? `Embedded resource: ${res.uri}` : 'Embedded resource';
      lines.push(color.title(`${header}:`));
      const mime = typeof res.mimeType === 'string' ? res.mimeType : undefined;
      if (typeof res.text === 'string') {
        lines.push(...rendertext(res.text, options, mime));
      } else if (typeof res.blob === 'string') {
        const data = decode(res.blob);
        lines.push(...renderbinary('Binary', mime, data.length, color, multi));
      }
      lines.push('');
      continue;
    }

    const fallback = JSON.stringify(item, null, 2);
    const type = typeof item.type === 'string' ? item.type : 'unknown';
    lines.push(color.title(`Unsupported content type: ${type}`));
    lines.push(fallback);
    lines.push('');
  }

  return lines.filter(function filterEmpty(line, index, arr) {
    if (line !== '') return true;
    return index < arr.length - 1 && arr[index + 1] !== '';
  });
}

/**
 * Format a readResource result into CLI-friendly lines.
 * @param {Array<Record<string, unknown>>} items - Resource content entries returned by readResource.
 * @param {{ markdown: boolean, ansi: boolean, tty: boolean, colors: boolean, theme: { accent: string, subtle: string } }} options - Output flags and theme settings.
 * @returns {Promise<string[]>}
 */
async function renderresources(items, options) {
  const color = palette(options.colors, options.theme);
  const lines = [];
  const multi = items.length > 1;
  for (const item of items) {
    const header = typeof item.uri === 'string' ? `Resource: ${item.uri}` : 'Resource';
    if (multi) {
      lines.push(color.title(`${header}:`));
    }
    const mime = typeof item.mimeType === 'string' ? item.mimeType : undefined;
    if (typeof item.text === 'string') {
      lines.push(...rendertext(item.text, options, mime));
    } else if (typeof item.blob === 'string') {
      const data = decode(item.blob);
      lines.push(...renderbinary('Binary', mime, data.length, color, multi));
    }
    if (multi) lines.push('');
  }
  return lines.filter(function filterEmpty(line, index, arr) {
    if (line !== '') return true;
    return index < arr.length - 1 && arr[index + 1] !== '';
  });
}

/**
 * Format tool/prompt results and write to stdout.
 * @param {Record<string, unknown>} result - Tool or prompt result payload.
 * @param {{ raw: boolean, markdown: boolean, ansi: boolean, tty: boolean, colors: boolean, theme: { accent: string, subtle: string } }} options - Output flags and theme settings.
 * @returns {Promise<void>}
 */
export async function outputresult(result, options) {
  const content = Array.isArray(result.content) ? result.content : [];
  if (options.raw) {
    const buffer = singlebinary(content);
    if (buffer) {
      writebuffer(buffer);
      return;
    }
    writelines([JSON.stringify(result, null, 2)]);
    return;
  }

  const lines = await rendercontent(content, options);
  const structured = result.structuredContent;
  if (structured && typeof structured === 'object') {
    if (lines.length > 0) lines.push('');
    lines.push('Structured content:');
    lines.push(JSON.stringify(structured, null, 2));
  }
  writelines(lines);
}

/**
 * Format readResource results and write to stdout.
 * @param {Record<string, unknown>} result - readResource payload.
 * @param {{ raw: boolean, markdown: boolean, ansi: boolean, tty: boolean, colors: boolean, theme: { accent: string, subtle: string } }} options - Output flags and theme settings.
 * @returns {Promise<void>}
 */
export async function outputresource(result, options) {
  const items = Array.isArray(result.contents) ? result.contents : [];
  if (options.raw) {
    const buffer = singleblob(items);
    if (buffer) {
      writebuffer(buffer);
      return;
    }
    const text = singleresource(items);
    if (text !== null) {
      process.stdout.write(sanitize(text, options));
      return;
    }
    writelines([JSON.stringify(result, null, 2)]);
    return;
  }
  const lines = await renderresources(items, options);
  writelines(lines);
}
