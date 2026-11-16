import { forward } from '@mcp-layer/forward';
import { LayerError } from '@mcp-layer/error';
import { settings, storage } from './connection.js';
import { select } from './config.js';
import { table, jsonout } from './output.js';

/**
 * Read a textual command option.
 * @param {Record<string,unknown>} parsed Parsed argv.
 * @param {string} name Option name without dashes.
 * @returns {string|undefined} String value, or absence.
 */
function text(parsed, name) { return typeof parsed[name] === 'string' ? parsed[name] : undefined; }

/**
 * Read an optional numeric command option.
 * @param {unknown} value Parsed flag value.
 * @returns {number|undefined} Numeric option, or absence.
 */
function number(value) { return value === undefined ? undefined : Number(value); }

/**
 * Wait for a hosted forwarding gateway, closing it on process termination signals.
 * @param {{url?:string,close:()=>Promise<void>,closed:Promise<void>}} runtime Owned forwarding lifecycle.
 * @returns {Promise<void>} Completion after shutdown.
 */
async function serve(runtime) {
  let failure;
  /** @param {unknown} cause Shutdown failure. @returns {void} Retain the failure for the lifecycle promise. */
  function failed(cause) { failure = cause; }
  /** @returns {void} Close the runtime once after an interrupt or termination request. */
  function stop() { void runtime.close().catch(failed); }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (!runtime.url) process.stdin.once('end', stop);
  if (runtime.url) process.stderr.write(`${runtime.url}\n`);
  try {
    await runtime.closed;
    if (failure) throw failure;
  } finally {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.stdin.removeListener('end', stop);
  }
}

/**
 * Resolve an explicit forwarding URL or one configured remote MCP server.
 * @param {string|null} target Optional URL positional.
 * @param {import('./connection.js').ConnectionOptions} options Server selection flags.
 * @returns {Promise<string>} Selected HTTP endpoint.
 * @throws {LayerError} When the configured server does not expose a remote URL.
 */
async function remote(target, options) {
  if (target) return target;
  const selected = await select(options);
  const entry = selected.config.get(selected.name);
  const url = entry?.config?.url ?? entry?.config?.endpoint;
  if (typeof url === 'string') return url;
  throw new LayerError({ name: 'cli', method: 'remote', code: 'ERR_CLI_REMOTE', message: 'Choose a remote MCP URL for forwarding.' });
}

/**
 * Print forward-only usage without resolving configuration or contacting a server.
 * @param {string} name CLI display name.
 * @returns {void} Writes gateway syntax and supported runtime flags to stdout.
 */
function help(name) {
  const lines = [
    `${name} forward [url] [--transport http|stdio] [--no-oauth] [--status]`,
    'Gateway flags: --host --port --base-url; config selection: --config --server',
    'Identity: --profile <id|file> --profile-parts http,mcp,oauth',
    'OAuth: --oauth --client-id --issuer --scope --resource --callback-port --callback-url --auth-timeout',
    'Storage: --storage-dir --storage-backend auto|native|file',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

/**
 * Limit status diagnostics to the URL origin.
 * @param {string} value Target URL.
 * @returns {string} URL origin, or a redacted invalid URL marker.
 */
function safeTarget(value) {
  if (!URL.canParse(value)) return '[invalid URL]';
  return new URL(value).origin;
}

/**
 * Execute a forwarding gateway or report its OAuth status.
 * @param {{surface:string,action:string,target:string|null}} command Routed built-in command.
 * @param {Record<string,unknown>} parsed Original parsed argv.
 * @param {import('./connection.js').ConnectionOptions} options Shared runtime connection options.
 * @param {string} name CLI display name.
 * @returns {Promise<boolean>} Whether a built-in command handled the invocation.
 * @throws {LayerError} When the configured server has no remote endpoint.
 */
export async function commands(command, parsed, options, name) {
  if (command.surface !== 'forward') return false;
  if (options.help) {
    help(name);
    return true;
  }
  const target = await remote(command.target, options);
  const applied = await settings(options, target, { oauth: options.oauth ?? true });
  try {
    if (parsed.status) {
      const status = applied.authProvider ? await applied.authProvider.status() : { target: safeTarget(target), auth: false, storage: await storage(options).status() };
      if (options.format === 'json') jsonout(status);
      else table(['Field', 'Value'], [
        ['Target', status.target],
        ['Issuer', String(status.issuer)],
        ['Registered', String(status.registered)],
        ['Refreshable', String(status.refreshable)],
        ['Storage', status.storage.directory],
      ]);
      return true;
    }
    const runtime = await forward({
      target,
      transport: options.transport,
      auth: options.oauth ?? true,
      host: text(parsed, 'host'),
      port: number(parsed.port),
      baseUrl: text(parsed, 'base-url'),
      storage: applied.storage,
      authProvider: applied.authProvider,
      headers: applied.headers,
      info: applied.info,
      fetch: applied.fetch,
    });
    await serve(runtime);
  } finally {
    await applied.close();
  }
  return true;
}
