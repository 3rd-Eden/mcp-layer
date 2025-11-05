import { promises as fs } from 'node:fs';
import path from 'node:path';

const EXTENSION_STORAGE = 'cline.bot-cline';
const SETTINGS_FILENAME = 'cline_mcp_settings.json';

/**
 * Cline does not support project-local configuration files.
 * @returns {string[]}
 */
function project() {
  return [];
}

/**
 * Resolve user-level configuration files for Cline.
 * @param {{ home?: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform }} ctx
 * @returns {string[]}
 */
function home(ctx) {
  const list = [];

  if (ctx.env.CLINE_MCP_SETTINGS_PATH) {
    const custom = ctx.env.CLINE_MCP_SETTINGS_PATH.startsWith('~') && ctx.home
      ? path.join(ctx.home, ctx.env.CLINE_MCP_SETTINGS_PATH.slice(1))
      : ctx.env.CLINE_MCP_SETTINGS_PATH;
    list.push(custom);
  }

  /**
   * @param {string | undefined} base
   * @param {string} product
   */
  function push(base, product) {
    if (base) {
      list.push(path.join(base, product, 'User', 'globalStorage', EXTENSION_STORAGE, SETTINGS_FILENAME));
    }
  }

  if (ctx.platform === 'win32') {
    const appData = ctx.env.APPDATA ?? (ctx.home ? path.join(ctx.home, 'AppData', 'Roaming') : undefined);
    push(appData, 'Code');
    push(appData, 'Code - Insiders');
    push(appData, 'VSCodium');
  } else if (ctx.platform === 'darwin') {
    const support = ctx.home ? path.join(ctx.home, 'Library', 'Application Support') : undefined;
    push(support, 'Code');
    push(support, 'Code - Insiders');
    push(support, 'VSCodium');
  } else {
    const config = ctx.env.XDG_CONFIG_HOME ?? (ctx.home ? path.join(ctx.home, '.config') : undefined);
    push(config, 'Code');
    push(config, 'Code - Insiders');
    push(config, 'VSCodium');
  }

  return list;
}

/**
 * Parse Cline configuration documents.
 * @param {string} raw
 * @param {string} file
 * @returns {{ servers: Array<{ name: string, config: Record<string, unknown> }>, metadata: Record<string, unknown> }}
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

  const metadata = {};
  if (doc && typeof doc === 'object') {
    if (Array.isArray(doc.autoApprove)) {
      metadata.autoApprove = doc.autoApprove;
    }
    if (typeof doc.defaultMode === 'string') {
      metadata.defaultMode = doc.defaultMode;
    }
  }

  return { servers: list, metadata };
}

export const cline = {
  name: 'cline',
  project,
  home,
  parse,
  write
};

/**
 * Merge Cline server definitions into JSON settings while preserving extension specific metadata.
 * @param {string} file
 * @param {{ name: string, config: Record<string, unknown> } | null} entry
 * @param {{ servers?: Array<{ name: string, config: Record<string, unknown> }> } & Record<string, unknown>} [metadata]
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
  } else if (metadata && Array.isArray(metadata.servers)) {
    doc.mcpServers = {};
    for (const item of metadata.servers) {
      doc.mcpServers[item.name] = item.config;
    }
  }

  if (metadata && typeof metadata === 'object') {
    for (const [key, value] of Object.entries(metadata)) {
      if (key === 'servers') {
        continue;
      }
      doc[key] = value;
    }
  }

  const output = `${JSON.stringify(doc, null, 2)}\n`;
  await fs.writeFile(file, output, 'utf8');
}
