import { derive, list } from '@mcp-layer/profiles';
import { forward } from '@mcp-layer/forward';
import { LayerError } from '@mcp-layer/error';
import { capture } from './capture.js';
import { read, write, profile } from './artifact.js';
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
 * Wait for a hosted runtime, closing it on process termination signals.
 * @param {{url?:string,close:()=>Promise<void>,closed:Promise<void>}} runtime Owned capture or forwarding lifecycle.
 * @returns {Promise<void>} Completion after shutdown and any capture artifact write.
 */
async function serve(runtime) {
  let failure;
  /** @param {unknown} cause Shutdown failure. @returns {void} Retain the failure for the rendering promise. */
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
 * Render command-specific instructions without connecting to an MCP server.
 * @param {string} surface Built-in command surface.
 * @param {string} name CLI display name.
 * @returns {void} Writes static usage to stdout.
 */
function help(surface, name) {
  const lines = surface === 'profiles' ? [
    `${name} profiles list [--format json]`,
    `${name} profiles show <profile-id|profile.json> [--format json]`,
    `${name} profiles build <capture.json> --output <profile.json>`,
    `${name} profiles capture --output <capture.json> [--transport http|sse|stdio] [--oauth] [--upstream <url>]`,
    'Capture flags: --host --port --base-url --client-name --client-version --allow-headers',
  ] : [
    `${name} forward [url] [--transport http|stdio] [--no-oauth] [--status]`,
    'Gateway flags: --host --port --base-url; config selection: --config --server',
  ];
  process.stdout.write(`${lines.join('\n')}\n\nIdentity: --profile <id|file> --profile-parts http,mcp,oauth\nOAuth: --oauth --client-id --issuer --scope --resource --callback-port --auth-timeout\nStorage: --storage-dir --storage-backend auto|native|file\n`);
}

/**
 * Execute offline profile operations, capture hosts and forwarding gateways.
 * @param {{surface:string,action:string,target:string|null}} command Routed built-in command.
 * @param {Record<string,unknown>} parsed Original parsed argv.
 * @param {import('./connection.js').ConnectionOptions} options Shared runtime connection options.
 * @param {string} name CLI display name.
 * @returns {Promise<boolean>} Whether a built-in command handled the invocation.
 * @throws {LayerError} For missing artifact paths or unknown profile operations.
 */
export async function commands(command, parsed, options, name) {
  if (!['profiles', 'forward'].includes(command.surface)) return false;
  if (options.help) { help(command.surface, name); return true; }
  if (command.surface === 'profiles') {
    if (command.action === 'list') {
      const profiles = list();
      /** @param {import('@mcp-layer/profiles').Profile} value Bundled profile. @returns {string[]} Public identity table cells. */
      function row(value) { return [value.id, value.client.name, value.client.version]; }
      if (options.format === 'json') jsonout(profiles);
      else table(['Profile', 'Client', 'Version'], profiles.map(row));
      return true;
    }
    if (command.action === 'show') {
      if (!command.target) throw new LayerError({ name: 'cli', method: 'commands', code: 'ERR_CLI_PROFILE_INPUT', message: 'Provide a profile ID or JSON path.' });
      const value = await profile(command.target);
      if (options.format === 'json') jsonout(value);
      else table(['Field', 'Value'], [
        ['Profile', value.id],
        ['Client', value.client.name],
        ['Version', value.client.version],
        ['Phases', value.coverage.phases.join(', ')],
        ['Perspectives', value.coverage.perspectives.join(', ')],
        ['Observations', String(value.coverage.observations)],
      ]);
      return true;
    }
    if (command.action === 'build') {
      const output = text(parsed, 'output');
      if (!command.target || !output) throw new LayerError({ name: 'cli', method: 'commands', code: 'ERR_CLI_PROFILE_INPUT', message: 'Provide a capture JSON path and --output <profile.json>.' });
      await write(output, derive(await read(command.target)));
      return true;
    }
    if (command.action === 'capture') {
      const output = text(parsed, 'output');
      if (!output) throw new LayerError({ name: 'cli', method: 'commands', code: 'ERR_CLI_PROFILE_INPUT', message: 'Provide --output <capture.json> for the capture artifact.' });
      const upstream = text(parsed, 'upstream');
      const applied = upstream ? await settings(options, upstream, { oauth: Boolean(options.oauth) }) : undefined;
      try {
        const client = text(parsed, 'client-name');
        const version = text(parsed, 'client-version');
        /** @param {string} value Header flag entry. @returns {string} Header name without surrounding whitespace. */
        function trimmed(value) { return value.trim(); }
        const runtime = await capture({
          output,
          transport: options.transport,
          host: text(parsed, 'host'),
          port: number(parsed.port),
          baseUrl: text(parsed, 'base-url'),
          client: client !== undefined || version !== undefined ? { name: client, version } : undefined,
          allowHeaders: text(parsed, 'allow-headers')?.split(',').map(trimmed),
          upstream,
          oauth: options.oauth && !upstream && options.scope ? { scopes: options.scope.split(/\s+/).filter(Boolean) } : Boolean(options.oauth),
          storage: applied?.storage ?? (options.oauth ? storage(options) : undefined),
          // Forward constructs this provider with the capture recorder attached before OAuth traffic begins.
          authorization: applied?.authorization,
          headers: applied?.headers,
          info: applied?.info,
          fetch: applied?.authorization?.fetch ?? applied?.fetch,
        });
        await serve(runtime);
      } finally {
        await applied?.close();
      }
      return true;
    }
    throw new LayerError({ name: 'cli', method: 'commands', code: 'ERR_CLI_PROFILE_COMMAND', message: 'Unknown profiles command "{command}".', vars: { command: command.action } });
  }
  const target = await remote(command.target, options);
  const applied = await settings(options, target, { oauth: options.oauth ?? true });
  try {
    if (parsed.status) {
      const status = applied.authProvider ? await applied.authProvider.status() : { target, auth: false, storage: await storage(options).status() };
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
