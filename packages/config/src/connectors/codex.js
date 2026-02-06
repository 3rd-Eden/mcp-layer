import { promises as fs } from 'node:fs';
import path from 'node:path';
import { parse as parseToml } from '@iarna/toml';
import stringify from '@iarna/toml/stringify.js';

/**
 * Resolve project-scoped configuration files for Codex.
 * @param {string} dir - Project root directory (unused for Codex).
 * @returns {string[]}
 */
function project(dir) {
  void dir;
  return [];
}

/**
 * Resolve user-level configuration files for Codex.
 * @param {{ home?: string, env: NodeJS.ProcessEnv }} ctx - Environment context for path resolution.
 * @returns {string[]}
 */
function home(ctx) {
  const list = [];
  const base = ctx.env.CODEX_HOME ? ctx.env.CODEX_HOME : ctx.home ? path.join(ctx.home, '.codex') : undefined;
  if (!base) return list;
  list.push(path.join(base, 'config.toml'));
  return list;
}

/**
 * Parse Codex configuration files written in TOML.
 * @param {string} raw - Raw TOML string from the config file.
 * @param {string} file - File path used for error reporting.
 * @returns {{ servers: Array<{ name: string, config: Record<string, unknown> }> }}
 */
function parse(raw, file) {
  let doc;
  try {
    doc = parseToml(raw);
  } catch (error) {
    throw new Error(`Failed to parse TOML for ${file}: ${(error instanceof Error ? error.message : 'unknown error')}`);
  }

  const body = doc && typeof doc === 'object' ? doc : {};

  const servers = /** @type {Record<string, unknown> | undefined} */ (body.mcp_servers);
  if (!servers || typeof servers !== 'object') {
    return { servers: [], metadata: {} };
  }

  const list = [];
  for (const [name, value] of Object.entries(servers)) {
    if (!value || typeof value !== 'object') continue;
    list.push({ name, config: /** @type {Record<string, unknown>} */ (value) });
  }
  return { servers: list, metadata: {} };
}

export const codex = {
  name: 'codex',
  project,
  home,
  parse,
  write
};

/**
 * Merge Codex server definitions into TOML configuration files while preserving metadata.
 * @param {string} file - Destination config file path.
 * @param {{ name: string, config: Record<string, unknown> } | null} entry - Server entry to upsert or null to overwrite with metadata.servers.
 * @param {{ servers?: Array<{ name: string, config: Record<string, unknown> }> }} [metadata] - Optional server list for full rewrite.
 * @returns {Promise<void>}
 */
async function write(file, entry, metadata = {}) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });

  let doc;
  try {
    const raw = await fs.readFile(file, 'utf8');
    doc = parseToml(raw);
  } catch {
    doc = {};
  }

  const body = doc && typeof doc === 'object' ? doc : {};

  if (!body.mcp_servers || typeof body.mcp_servers !== 'object') {
    body.mcp_servers = {};
  }

  if (entry) {
    body.mcp_servers[entry.name] = entry.config;
  } else if (Array.isArray(metadata.servers)) {
    body.mcp_servers = {};
    for (const item of metadata.servers) {
      body.mcp_servers[item.name] = item.config;
    }
  }

  const output = stringify(body);
  await fs.writeFile(file, output, 'utf8');
}
