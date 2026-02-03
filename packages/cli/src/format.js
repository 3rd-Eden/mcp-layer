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
  if (markdownReady) {
    return;
  }
  marked.use(markedTerminal());
  markdownReady = true;
}

/**
 * Determine if a text block looks like Markdown.
 * @param {string} text
 * @param {string | undefined} mimeType
 * @returns {boolean}
 */
function ismarkdown(text, mimeType) {
  if (mimeType === 'text/markdown' || mimeType === 'text/md') {
    return true;
  }
  const sample = text.trim();
  return /^#{1,6}\s/.test(sample)
    || /```/.test(sample)
    || /\*\*[^*]+\*\*/.test(sample)
    || /^\s*-\s+/.test(sample)
    || /^\s*\d+\.\s+/.test(sample);
}

/**
 * Render a text block with optional Markdown formatting.
 * @param {string} text
 * @param {{ markdown: boolean, tty: boolean }} options
 * @param {string | undefined} mimeType
 * @returns {string[]}
 */
function rendertext(text, options, mimeType) {
  if (options.markdown && options.tty && ismarkdown(text, mimeType)) {
    setupmarkdown();
    const output = marked.parse(text);
    return String(output).trimEnd().split('\n');
  }
  return String(text).split('\n');
}

/**
 * Decode base64 data into a buffer.
 * @param {string} data
 * @returns {Buffer}
 */
function decode(data) {
  return Buffer.from(data, 'base64');
}

/**
 * Format a byte size for display.
 * @param {number} size
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
 * Check if a content item is an image payload.
 * @param {Record<string, unknown>} item
 * @returns {boolean}
 */
function isimage(item) {
  return item.type === 'image' && typeof item.data === 'string';
}

/**
 * Check if a content item is an audio payload.
 * @param {Record<string, unknown>} item
 * @returns {boolean}
 */
function isaudio(item) {
  return item.type === 'audio' && typeof item.data === 'string';
}

/**
 * Check if a content item is a resource link.
 * @param {Record<string, unknown>} item
 * @returns {boolean}
 */
function islink(item) {
  return item.type === 'resource_link' && typeof item.uri === 'string';
}

/**
 * Check if a content item is an embedded resource.
 * @param {Record<string, unknown>} item
 * @returns {boolean}
 */
function isresource(item) {
  return item.type === 'resource' && typeof item.resource === 'object' && item.resource !== null;
}

/**
 * Check if a resource content entry is binary.
 * @param {Record<string, unknown>} item
 * @returns {boolean}
 */
function isblob(item) {
  return typeof item.blob === 'string';
}

/**
 * Render a resource link entry.
 * @param {Record<string, unknown>} item
 * @param {{ title: (text: string) => string, subtle: (text: string) => string }} color
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
 * @param {string} label
 * @param {string | undefined} mimeType
 * @param {number} size
 * @param {{ subtle: (text: string) => string }} color
 * @returns {string[]}
 */
function renderbinary(label, mimeType, size, color) {
  const mime = mimeType ? ` ${mimeType}` : '';
  return [`${label}:${mime} ${color.subtle(`(${bytes(size)})`)} Use --raw to pipe.`];
}

/**
 * Emit a buffer directly to stdout.
 * @param {Buffer} buffer
 * @returns {void}
 */
function writebuffer(buffer) {
  process.stdout.write(buffer);
}

/**
 * Emit a list of lines to stdout.
 * @param {string[]} lines
 * @returns {void}
 */
function writelines(lines) {
  if (lines.length === 0) {
    return;
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * Extract a single binary payload for raw output.
 * @param {Array<Record<string, unknown>>} items
 * @returns {Buffer | null}
 */
function singlebinary(items) {
  if (items.length !== 1) {
    return null;
  }
  const item = items[0];
  if (isimage(item) || isaudio(item)) {
    return decode(String(item.data));
  }
  if (isresource(item) && item.resource && typeof item.resource === 'object') {
    const res = /** @type {Record<string, unknown>} */ (item.resource);
    if (typeof res.blob === 'string') {
      return decode(res.blob);
    }
  }
  return null;
}

/**
 * Extract a single binary resource content entry.
 * @param {Array<Record<string, unknown>>} items
 * @returns {Buffer | null}
 */
function singleblob(items) {
  if (items.length !== 1) {
    return null;
  }
  const item = items[0];
  if (isblob(item)) {
    return decode(String(item.blob));
  }
  return null;
}

/**
 * Format content array into CLI-friendly lines.
 * @param {Array<Record<string, unknown>>} items
 * @param {{ raw: boolean, markdown: boolean, tty: boolean, colors: boolean, theme: { accent: string, subtle: string } }} options
 * @returns {Promise<string[]>}
 */
async function rendercontent(items, options) {
  const color = palette(options.colors, options.theme);
  const lines = [];
  const multi = items.length > 1;

  for (const item of items) {
    if (item.type === 'text' && typeof item.text === 'string') {
      if (multi) {
        lines.push(color.title('Text:'));
      }
      const mime = typeof item.mimeType === 'string' ? item.mimeType : undefined;
      lines.push(...rendertext(item.text, options, mime));
      if (multi) {
        lines.push('');
      }
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
          lines.push(...renderbinary('Image', mime, data.length, color));
        }
      } else {
        lines.push(...renderbinary('Image', mime, data.length, color));
      }
      lines.push('');
      continue;
    }

    if (isaudio(item)) {
      const mime = typeof item.mimeType === 'string' ? item.mimeType : undefined;
      const data = decode(String(item.data));
      lines.push(...renderbinary('Audio', mime, data.length, color));
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
        lines.push(...renderbinary('Binary', mime, data.length, color));
      }
      lines.push('');
      continue;
    }
  }

  return lines.filter(function filterEmpty(line, index, arr) {
    if (line !== '') {
      return true;
    }
    return index < arr.length - 1 && arr[index + 1] !== '';
  });
}

/**
 * Format a readResource result into CLI-friendly lines.
 * @param {Array<Record<string, unknown>>} items
 * @param {{ markdown: boolean, tty: boolean, colors: boolean, theme: { accent: string, subtle: string } }} options
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
      lines.push(...renderbinary('Binary', mime, data.length, color));
    }
    if (multi) {
      lines.push('');
    }
  }
  return lines.filter(function filterEmpty(line, index, arr) {
    if (line !== '') {
      return true;
    }
    return index < arr.length - 1 && arr[index + 1] !== '';
  });
}

/**
 * Format tool/prompt results and write to stdout.
 * @param {Record<string, unknown>} result
 * @param {{ raw: boolean, markdown: boolean, tty: boolean, colors: boolean, theme: { accent: string, subtle: string } }} options
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
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push('Structured content:');
    lines.push(JSON.stringify(structured, null, 2));
  }
  writelines(lines);
}

/**
 * Format readResource results and write to stdout.
 * @param {Record<string, unknown>} result
 * @param {{ raw: boolean, markdown: boolean, tty: boolean, colors: boolean, theme: { accent: string, subtle: string } }} options
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
    writelines([JSON.stringify(result, null, 2)]);
    return;
  }
  const lines = await renderresources(items, options);
  writelines(lines);
}
