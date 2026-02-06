import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Resolve workspace-scoped configuration files for VS Code.
 * @param {string} dir - Project root directory to search.
 * @returns {string[]}
 */
function project(dir) {
  return [
    path.join(dir, '.vscode', 'mcp.json'),
    path.join(dir, 'mcp.json')
  ];
}

/**
 * Resolve user-level configuration files for VS Code.
 * @param {{ home?: string }} ctx - Environment context for path resolution.
 * @returns {string[]}
 */
function home(ctx) {
  const list = [];
  if (!ctx.home) return list;
  list.push(path.join(ctx.home, '.vscode', 'mcp.json'));
  return list;
}

/**
 * Parse VS Code configuration documents.
 * @param {string} raw - Raw JSON string from the settings file.
 * @param {string} file - File path used for error reporting.
 * @returns {{ servers: Array<{ name: string, config: Record<string, unknown> }>, metadata: { inputs: Array<Record<string, unknown>> } }}
 */
function parse(raw, file) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON for ${file}: ${(error instanceof Error ? error.message : 'unknown error')}`);
  }

  const serversNode = doc && typeof doc === 'object' ? doc.servers : undefined;
  const inputsNode = doc && typeof doc === 'object' && Array.isArray(doc.inputs) ? doc.inputs : [];

  if (!serversNode || typeof serversNode !== 'object') {
    // Surface declared inputs so consumers can still prompt even if no servers were defined yet.
    return { servers: [], metadata: { inputs: inputsNode } };
  }

  const list = [];
  for (const [name, value] of Object.entries(serversNode)) {
    if (!value || typeof value !== 'object') continue;
    list.push({ name, config: /** @type {Record<string, unknown>} */ (value) });
  }

  // Preserve inputs because VS Code relies on them to request credentials at runtime.
  return { servers: list, metadata: { inputs: /** @type {Array<Record<string, unknown>>} */ (inputsNode) } };
}

export const vscode = {
  name: 'vscode',
  project,
  home,
  parse,
  write
};

/**
 * Merge VS Code servers into JSON configuration documents while preserving declared inputs metadata.
 * @param {string} file - Destination config file path.
 * @param {{ name: string, config: Record<string, unknown> } | null} entry - Server entry to upsert or null to overwrite with metadata.servers.
 * @param {{ servers?: Array<{ name: string, config: Record<string, unknown> }>, inputs?: Array<Record<string, unknown>> }} [metadata] - Optional servers/inputs metadata to merge.
 * @returns {Promise<void>}
 */
async function write(file, entry, metadata = {}) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });

  let doc;
  try {
    const raw = await fs.readFile(file, 'utf8');
    doc = JSON.parse(raw);
  } catch {
    doc = {};
  }

  if (!doc || typeof doc !== 'object') {
    doc = {};
  }

  if (!doc.servers || typeof doc.servers !== 'object') {
    doc.servers = {};
  }

  if (entry) {
    doc.servers[entry.name] = entry.config;
  } else if (metadata && Array.isArray(metadata.servers)) {
    doc.servers = {};
    for (const item of metadata.servers) {
      doc.servers[item.name] = item.config;
    }
  }

  if (metadata && typeof metadata === 'object' && Array.isArray(metadata.inputs)) doc.inputs = metadata.inputs;

  const output = `${JSON.stringify(doc, null, 2)}\n`;
  await fs.writeFile(file, output, 'utf8');
}
