import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createRequire } from 'node:module';
import { LayerError } from '@mcp-layer/error';
import { Session } from '@mcp-layer/session';
import path from 'node:path';

const read = createRequire(import.meta.url);
const pkg = read('../package.json');
const base = {
  name: 'mcp-layer',
  version: typeof pkg.version === 'string' ? pkg.version : '0.0.0'
};

/**
 * Select a server entry from a config source so connect can treat Config wrappers and Maps identically.
 * @param {Map<string, { name: string, source: string, config: Record<string, unknown> }> | { get: (name: string) => { name: string, source: string, config: Record<string, unknown> } | undefined }} src - Config source map or map-like wrapper.
 * @param {string} name - Server name to retrieve.
 * @returns {{ name: string, source: string, config: Record<string, unknown> } | undefined}
 */
export function select(src, name) {
  if (src instanceof Map) return src.get(name);
  if (src && typeof src === 'object' && typeof src.get === 'function') return src.get(name);
  throw new LayerError({
    name: 'connect',
    method: 'select',
    message: 'Expected config source to support get(name).',
  });
}

/**
 * Derive transport parameters from a server entry so the SDK spawns processes with the intended cwd and env.
 * @param {{ name: string, source: string, config: Record<string, unknown> }} item - Server entry pulled from config.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stderr?: 'pipe' | 'overlapped' | 'inherit' }} [opts] - Transport overrides for cwd/env/stderr.
 * @returns {{ command: string, args?: string[], cwd?: string, env?: NodeJS.ProcessEnv, stderr?: 'pipe' | 'overlapped' | 'inherit' }}
 */
export function setup(item, opts = {}) {
  const cfg = item.config ?? {};
  const cmd = typeof cfg.command === 'string' ? cfg.command : undefined;
  if (!cmd) {
    throw new LayerError({
      name: 'connect',
      method: 'setup',
      message: 'Server "{server}" is missing a "command" property required for stdio transport.',
      vars: { server: item.name }
    });
  }

  const list = Array.isArray(cfg.args) ? cfg.args.map(String) : undefined;
  const dir = path.dirname(item.source);

  // We pick config directory as default working directory so relative paths stay aligned with user expectations.
  const cwd = opts.cwd ?? (cfg.cwd ? path.resolve(dir, String(cfg.cwd)) : dir);

  // We merge caller env with config env to honour explicit overrides while preserving defaults.
  const env = {
    ...(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}),
    ...(opts.env ?? {}),
    MCP_CLIENT_AGENT: `${base.name}/${base.version}`
  };

  const stderr = typeof opts.stderr === 'string' ? opts.stderr : undefined;
  return { command: cmd, args: list, cwd, env, stderr };
}

export { Session };

/**
 * Connect to a configured MCP server using the official SDK.
 * @param {Map<string, { name: string, source: string, config: Record<string, unknown> }> | { get: (name: string) => { name: string, source: string, config: Record<string, unknown> } | undefined }} src - Config source map or map-like wrapper.
 * @param {string} name - Server name to connect to.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stderr?: 'pipe' | 'overlapped' | 'inherit', info?: { name: string, version: string } }} [opts] - Transport overrides and client metadata.
 * @returns {Promise<Session>}
 */
export async function connect(src, name, opts = {}) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new LayerError({
      name: 'connect',
      method: 'connect',
      message: 'Expected server name to be a non-empty string.',
    });
  }

  const item = select(src, name);
  if (!item) {
    throw new LayerError({
      name: 'connect',
      method: 'connect',
      message: 'Server "{server}" was not found in configuration.',
      vars: { server: name }
    });
  }

  const info = { ...base, ...(opts.info ?? {}) };
  const set = setup(item, opts);
  const transport = new StdioClientTransport(set);
  const client = new Client(info);

  // We rely on the official client to orchestrate handshake semantics.
  await client.connect(transport);

  return new Session({
    name,
    source: item.source,
    entry: item,
    client,
    transport,
    info
  });
}
