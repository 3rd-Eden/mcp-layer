import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
const labels = {
  stdio: 'stdio',
  sse: 'sse',
  http: 'streamable-http',
  'streamable-http': 'streamable-http',
  streamablehttp: 'streamable-http'
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

  // We inherit process env by default, then apply config and runtime overrides in order.
  const env = {
    ...process.env,
    ...(cfg.env && typeof cfg.env === 'object' ? cfg.env : {}),
    ...(opts.env ?? {}),
    MCP_CLIENT_AGENT: `${base.name}/${base.version}`
  };

  const stderr = typeof opts.stderr === 'string' ? opts.stderr : undefined;
  return { command: cmd, args: list, cwd, env, stderr };
}

/**
 * Normalize transport configuration into a supported transport key.
 * @param {unknown} value - Raw transport value from config or options.
 * @returns {'stdio' | 'streamable-http' | 'sse' | undefined}
 */
function transport(value) {
  if (typeof value !== 'string') return undefined;
  return labels[value.toLowerCase()];
}

/**
 * Normalize raw values into a string when possible.
 * @param {unknown} value - Raw value that may be a string.
 * @returns {string | undefined}
 */
function text(value) {
  if (typeof value !== 'string') return undefined;
  return value;
}

/**
 * Resolve the remote transport URL from options/config and validate it.
 * @param {{ name: string, config: Record<string, unknown> }} item - Config entry with possible url/endpoint values.
 * @param {{ url?: string }} [opts] - Optional explicit URL override.
 * @returns {URL}
 */
function remoteurl(item, opts = {}) {
  const cfg = item.config ?? {};
  const value = text(opts.url) ?? text(cfg.url) ?? text(cfg.endpoint) ?? '';

  if (!value) {
    throw new LayerError({
      name: 'connect',
      method: 'connect',
      message: 'Server "{server}" is missing a URL/endpoint required for remote transport.',
      vars: { server: item.name }
    });
  }

  try {
    return new URL(value);
  } catch {
    throw new LayerError({
      name: 'connect',
      method: 'connect',
      message: 'Server "{server}" URL "{url}" is not a valid URL.',
      vars: { server: item.name, url: value }
    });
  }
}

/**
 * Determine which transport should be used for a server entry.
 * @param {{ config: Record<string, unknown>, name: string }} item - Config entry.
 * @param {{ transport?: string }} [opts] - Explicit transport override.
 * @returns {'stdio' | 'streamable-http' | 'sse'}
 */
function mode(item, opts = {}) {
  const cfg = item.config ?? {};
  const explicit = transport(opts.transport);
  if (typeof opts.transport === 'string' && !explicit) {
    throw new LayerError({
      name: 'connect',
      method: 'connect',
      message: 'Transport "{transport}" is not supported. Use "stdio", "streamable-http", or "sse".',
      vars: { transport: opts.transport }
    });
  }

  const pick = explicit ?? transport(cfg.type);
  if (pick) return pick;

  if (typeof cfg.command === 'string' && cfg.command.length > 0) return 'stdio';
  if (typeof cfg.url === 'string' || typeof cfg.endpoint === 'string') return 'streamable-http';

  throw new LayerError({
    name: 'connect',
    method: 'connect',
    message: 'Server "{server}" is missing a supported transport configuration.',
    vars: { server: item.name }
  });
}

/**
 * Create a streamable HTTP transport from a server entry.
 * @param {{ name: string, config: Record<string, unknown> }} item - Config entry.
 * @param {{ url?: string, requestInit?: RequestInit, fetch?: typeof fetch, sessionId?: string, reconnectionOptions?: { maxReconnectionDelay: number, initialReconnectionDelay: number, reconnectionDelayGrowFactor: number, maxRetries: number } }} [opts] - Optional remote transport overrides.
 * @returns {StreamableHTTPClientTransport}
 */
function streamable(item, opts = {}) {
  const url = remoteurl(item, opts);
  return new StreamableHTTPClientTransport(url, {
    requestInit: opts.requestInit,
    fetch: opts.fetch,
    sessionId: opts.sessionId,
    reconnectionOptions: opts.reconnectionOptions
  });
}

/**
 * Create an SSE transport from a server entry.
 * @param {{ name: string, config: Record<string, unknown> }} item - Config entry.
 * @param {{ url?: string, requestInit?: RequestInit, eventSourceInit?: import('eventsource').EventSourceInit, fetch?: typeof fetch }} [opts] - Optional remote transport overrides.
 * @returns {SSEClientTransport}
 */
function sse(item, opts = {}) {
  const url = remoteurl(item, opts);
  return new SSEClientTransport(url, {
    requestInit: opts.requestInit,
    eventSourceInit: opts.eventSourceInit,
    fetch: opts.fetch
  });
}

export { Session };

/**
 * Connect to a configured MCP server using the official SDK.
 * @param {Map<string, { name: string, source: string, config: Record<string, unknown> }> | { get: (name: string) => { name: string, source: string, config: Record<string, unknown> } | undefined }} src - Config source map or map-like wrapper.
 * @param {string} name - Server name to connect to.
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, stderr?: 'pipe' | 'overlapped' | 'inherit', info?: { name: string, version: string }, transport?: 'stdio' | 'http' | 'streamable-http' | 'streamableHttp' | 'sse', url?: string, requestInit?: RequestInit, eventSourceInit?: import('eventsource').EventSourceInit, fetch?: typeof fetch, sessionId?: string, reconnectionOptions?: { maxReconnectionDelay: number, initialReconnectionDelay: number, reconnectionDelayGrowFactor: number, maxRetries: number } }} [opts] - Transport overrides and client metadata.
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
  const kind = mode(item, opts);
  const client = new Client(info);

  const link = kind === 'stdio'
    ? new StdioClientTransport(setup(item, opts))
    : kind === 'sse'
      ? sse(item, opts)
      : streamable(item, opts);

  // We rely on the official client to orchestrate handshake semantics.
  await client.connect(link);

  return new Session({
    name,
    source: item.source,
    entry: item,
    client,
    transport: link,
    info
  });
}
