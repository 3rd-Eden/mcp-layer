import argh from 'argh';
import { LayerError } from '@mcp-layer/error';

/**
 * @typedef {object} GlobalOptions
 * @property {string} [server] Configured server name.
 * @property {string} [config] MCP configuration path.
 * @property {string} [format] Output format.
 * @property {string} [json] JSON arguments.
 * @property {string} [input] JSON arguments file.
 * @property {string} [transport] Runtime transport override.
 * @property {number} [timeout] Connection deadline in milliseconds.
 * @property {string} [profile] Bundled profile ID or artifact path.
 * @property {import('@mcp-layer/profiles').Part[]} [parts] Selected public identity layers.
 * @property {boolean} [oauth] Enable interactive OAuth.
 * @property {string} [clientId] Explicit public OAuth client ID.
 * @property {string} [issuer] Explicit authorization server URL.
 * @property {string} [scope] Explicit OAuth scope string.
 * @property {string} [resource] Explicit OAuth resource indicator.
 * @property {number} [callbackPort] Loopback OAuth callback port.
 * @property {string} [redirectUrl] Loopback OAuth callback URL with the registered host and path.
 * @property {number} [authTimeout] OAuth interaction deadline in milliseconds.
 * @property {string} [storageDir] cli-storage directory override.
 * @property {'auto'|'native'|'file'} [storageBackend] cli-storage backend preference.
 * @property {boolean} help Whether help was requested.
 * @property {boolean} version Whether version was requested.
 * @property {boolean} colors Whether colors are enabled.
 * @property {boolean} spinner Whether the spinner is enabled.
 * @property {boolean} raw Whether raw output is requested.
 * @property {boolean} markdown Whether markdown rendering is enabled.
 * @property {boolean} ansi Whether server ANSI escapes are enabled.
 */

/**
 * Read an optional textual CLI flag.
 * @param {Record<string, unknown>} parsed Parsed flag values.
 * @param {string} key Flag name without leading dashes.
 * @returns {string | undefined} Explicit string value, or absence.
 */
function text(parsed, key) { return typeof parsed[key] === 'string' ? parsed[key] : undefined; }

/**
 * Split arguments at the passthrough separator.
 * @param {string[]} args - Raw argv list excluding `node` and script name.
 * @returns {{ main: string[], rest: string[] }}
 */
export function split(args) {
  const idx = args.indexOf('--');
  if (idx === -1) {
    return { main: args, rest: [] };
  }
  return { main: args.slice(0, idx), rest: args.slice(idx + 1) };
}

/**
 * Parse argv into globals and positionals.
 * @param {string[]} args - Raw argv list excluding `node` and script name.
 * @returns {{ parsed: Record<string, unknown>, positionals: string[], rest: string[], restParsed: Record<string, unknown> }}
 */
export function parse(args) {
  const parts = split(args);
  const parsed = argh(parts.main);
  const positionals = Array.isArray(parsed.argv) ? parsed.argv : [];
  const restParsed = parts.rest.length ? argh(parts.rest) : {};
  return { parsed, positionals, rest: parts.rest, restParsed };
}

/**
 * Normalize a numeric option value.
 * @param {unknown} value - Raw option value from arg parsing.
 * @returns {number | undefined}
 */
function numbervalue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Build global CLI options from parsed argv.
 * @param {Record<string, unknown>} parsed - Parsed flags from `argh` for the main argument list.
 * @returns {GlobalOptions} Normalized runtime flags; profile and OAuth settings never enter MCP configuration files.
 * @throws {LayerError} For unsupported profile parts.
 */
export function globals(parsed) {
  const help = Boolean(parsed.help || parsed.h);
  const version = Boolean(parsed.version);
  const server = typeof parsed.server === 'string' ? parsed.server : undefined;
  const config = typeof parsed.config === 'string' ? parsed.config : undefined;
  const format = typeof parsed.format === 'string' ? parsed.format : undefined;
  const json = typeof parsed.json === 'string' ? parsed.json : undefined;
  const input = typeof parsed.input === 'string' ? parsed.input : undefined;
  const transport = typeof parsed.transport === 'string' ? parsed.transport : undefined;
  const timeout = numbervalue(parsed.timeout);
  const colors = parsed.color === false ? false : true;
  const spinner = parsed.spinner === false ? false : true;
  const raw = Boolean(parsed.raw);
  const markdown = parsed.markdown === false ? false : true;
  const ansi = Boolean(parsed['allow-ansi']);
  /** @param {string} part Raw profile part. @returns {string} Whitespace-normalized part name. */
  function trimmed(part) { return part.trim(); }
  /** @param {string} part Profile part name. @returns {boolean} Whether the part is unsupported. */
  function unsupported(part) { return !['http', 'mcp', 'oauth'].includes(part); }
  const parts = text(parsed, 'profile-parts')?.split(',').map(trimmed);
  if (parts?.some(unsupported)) {
    throw new LayerError({ name: 'cli', method: 'globals', code: 'ERR_CLI_PROFILE_PARTS', message: 'Profile parts must be a comma-separated selection of http,mcp,oauth.' });
  }
  return {
    server, config, format, json, input, transport, timeout, help, version, colors, spinner, raw, markdown, ansi,
    profile: text(parsed, 'profile'), parts,
    oauth: typeof parsed.oauth === 'boolean' ? parsed.oauth : undefined,
    clientId: text(parsed, 'client-id'), issuer: text(parsed, 'issuer'), scope: text(parsed, 'scope'), resource: text(parsed, 'resource'),
    callbackPort: numbervalue(parsed['callback-port']), redirectUrl: text(parsed, 'callback-url'), authTimeout: numbervalue(parsed['auth-timeout']),
    storageDir: text(parsed, 'storage-dir'), storageBackend: text(parsed, 'storage-backend'),
  };
}

/**
 * Route definition for CLI commands.
 * @param {string[]} positionals - Positional arguments after flag parsing.
 * @returns {{ surface: string, action: string, target: string | null }}
 */
export function route(positionals) {
  if (positionals.length === 0) {
    return { surface: 'help', action: 'help', target: null };
  }
  const first = positionals[0];
  if (first.includes(':')) {
    const parts = first.split(':');
    return { surface: parts[0], action: 'exec', target: parts[1] ?? null };
  }
  const second = positionals[1];
  const third = positionals[2] ?? null;
  if (first === 'tools' || first === 'prompts' || first === 'resources' || first === 'templates') {
    if (!second || second === 'list') {
      return { surface: first, action: 'list', target: null };
    }
    return { surface: first, action: 'exec', target: second };
  }
  if (first === 'servers') {
    return { surface: 'servers', action: second === '' ? 'list' : second ?? 'list', target: third };
  }
  if (first === 'profiles') return { surface: 'profiles', action: second ?? 'list', target: third };
  if (first === 'forward') return { surface: 'forward', action: 'run', target: second ?? null };
  return { surface: 'help', action: 'help', target: null };
}
