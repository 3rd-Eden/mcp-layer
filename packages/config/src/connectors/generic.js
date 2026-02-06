import { readdirSync } from 'node:fs';
import path from 'node:path';
import { parseDocument, writeDocument } from '../schema.js';

const PROJECT_PATTERNS = [
  /^mcp.*\.json$/i,
  /^.*\.mcp\.json$/i,
  /^mcp.*\.ya?ml$/i,
  /^.*\.mcp\.ya?ml$/i
];

/**
 * Resolve generic MCP documents within the provided directory.
 * @param {string} dir - Directory to scan for MCP config filenames.
 * @returns {string[]}
 */
function project(dir) {
  const hits = new Set();
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (PROJECT_PATTERNS.some(function match(pattern) {
      return pattern.test(entry.name);
    })) {
      hits.add(path.join(dir, entry.name));
    }
  }

  return Array.from(hits);
}

/**
 * Extend discovery with additional known locations from popular clients.
 * @param {{ home?: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform }} ctx - Environment context for path resolution.
 * @returns {string[]}
 */
function home(ctx) {
  const hits = new Set();
  const base = ctx.home;

  /**
   * @param {string | undefined} candidate - Candidate file path to add to the result set.
   */
  function push(candidate) {
    if (candidate) hits.add(path.resolve(candidate));
  }

  push(ctx.env?.MCP_CONFIG_PATH && base && ctx.env.MCP_CONFIG_PATH.startsWith('~')
    ? path.join(base, ctx.env.MCP_CONFIG_PATH.slice(1))
    : ctx.env?.MCP_CONFIG_PATH);

  if (base) {
    push(path.join(base, '.config', 'mcp', 'servers.json'));
    push(path.join(base, '.config', 'mcp.json'));
    push(path.join(base, '.config', 'mcp.yaml'));
    push(path.join(base, '.config', 'mcp.yml'));
  }

  return Array.from(hits);
}

/**
 * Parse JSON or YAML documents and normalise them into shared server entries.
 * @param {string} raw - Raw document contents.
 * @param {string} file - File path used for error reporting.
 * @returns {{ servers: Array<{ name: string, config: Record<string, unknown> }>, metadata: Record<string, unknown> }}
 */
const parse = parseDocument;

/**
 * Merge generic server definitions into JSON or YAML configuration files.
 * @param {string} file - Destination config file path.
 * @param {{ name: string, config: Record<string, unknown> } | null} entry - Server entry to upsert or null to overwrite with metadata.servers.
 * @param {{ servers?: Array<{ name: string, config: Record<string, unknown> }> } & Record<string, unknown>} [metadata] - Optional metadata to merge.
 * @returns {Promise<void>}
 */
const write = writeDocument;

export const generic = {
  name: 'generic',
  project,
  home,
  parse,
  write
};
