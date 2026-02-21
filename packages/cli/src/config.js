import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { load } from '@mcp-layer/config';
import { LayerError } from '@mcp-layer/error';

const read = createRequire(import.meta.url);
const pkg = read('../package.json');

/**
 * Default CLI configuration.
 * @returns {{ name: string, version: string, description: string, colors: boolean, accent: string, subtle: string, spinner: boolean, markdown: boolean, ansi: boolean, server: string | undefined, config: string | undefined, showServers: boolean | undefined, timeout?: number }}
 */
export function defaults() {
  return {
    name: typeof pkg.name === 'string' ? pkg.name : 'mcp-layer',
    version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    description: typeof pkg.description === 'string' ? pkg.description : 'MCP CLI',
    colors: true,
    accent: '#FFA500',
    subtle: '#696969',
    spinner: true,
    markdown: true,
    ansi: false,
    server: undefined,
    config: undefined,
    showServers: true
  };
}

/**
 * Load configuration from discovery or explicit file.
 * @param {string | undefined} file - Optional config path or discovery anchor.
 * @returns {Promise<import('@mcp-layer/config').Config>}
 */
export async function configload(file) {
  if (!file) return load(undefined, process.cwd());
  try {
    const info = await stat(file);
    if (info.isFile()) {
      const raw = await readFile(file, 'utf8');
      const doc = JSON.parse(raw);
      return load(doc, { start: file });
    }
  } catch {
    // Fall back to discovery when file access fails.
  }
  return load(undefined, file);
}

/**
 * Load configuration and select a server.
 * @param {{ server?: string, config?: string }} opts - CLI selection options for server name and config path.
 * @returns {Promise<{ config: import('@mcp-layer/config').Config, name: string }>}
 */
export async function select(opts) {
  const cfg = await configload(opts.config);
  const name = opts.server;
  if (name && cfg.get(name)) {
    return { config: cfg, name };
  }
  const list = Array.from(cfg.map.keys());
  if (list.length === 1) {
    return { config: cfg, name: list[0] };
  }
  if (!name) {
    throw new LayerError({
      name: 'cli',
      method: 'select',
      message: 'Multiple servers found. Provide --server <name>.',
    });
  }
  throw new LayerError({
    name: 'cli',
    method: 'select',
    message: 'Server "{server}" was not found.',
    vars: { server: name }
  });
}
