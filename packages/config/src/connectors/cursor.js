import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Resolve project-scoped configuration files for Cursor.
 * @param {string} dir
 * @returns {string[]}
 */
function project(dir) {
  return [
    path.join(dir, '.cursor', 'mcp.json')
  ];
}

/**
 * Resolve user-level configuration files for Cursor.
 * @param {{ home?: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform }} ctx
 * @returns {string[]}
 */
function home(ctx) {
  const list = [];
  const base = ctx.home;
  if (!base) {
    return list;
  }

  list.push(path.join(base, '.cursor', 'mcp.json'));

  return list;
}

/**
 * Parse Cursor configuration files.
 * @param {string} raw
 * @param {string} file
 * @returns {{ servers: Array<{ name: string, config: Record<string, unknown> }> }}
 */
function parse(raw, file) {
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse JSON for ${file}: ${(error instanceof Error ? error.message : 'unknown error')}`);
  }

  const servers = doc && typeof doc === 'object' ? doc.mcpServers : undefined;
  if (!servers || typeof servers !== 'object') {
    return { servers: [], metadata: {} };
  }

  const list = [];
  for (const [name, value] of Object.entries(servers)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    list.push({ name, config: /** @type {Record<string, unknown>} */ (value) });
  }
  return { servers: list, metadata: {} };
}

export const cursor = {
  name: 'cursor',
  project,
  home,
  parse,
  write
};

/**
 * Merge Cursor server definitions into JSON configuration files while preserving metadata snapshots.
 * @param {string} file
 * @param {{ name: string, config: Record<string, unknown> } | null} entry
 * @param {{ servers?: Array<{ name: string, config: Record<string, unknown> }> }} [metadata]
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

  if (!doc.mcpServers || typeof doc.mcpServers !== 'object') {
    doc.mcpServers = {};
  }

  if (entry) {
    doc.mcpServers[entry.name] = entry.config;
  } else if (Array.isArray(metadata.servers)) {
    doc.mcpServers = {};
    for (const item of metadata.servers) {
      doc.mcpServers[item.name] = item.config;
    }
  }

  const output = `${JSON.stringify(doc, null, 2)}\n`;
  await fs.writeFile(file, output, 'utf8');
}
