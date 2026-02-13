import { defaults, configload, select } from './config.js';
import { parse, globals, route } from './argv.js';
import { mainhelp, serverhelp, toolhelp, prompthelp, resourcehelp, templatehelp, addsection, itemhelp, commandhelp } from './help-system.js';
import { table, jsonout } from './output.js';
import { inputs } from './inputs.js';
import { catalog, spinner as spin, spinnertext } from './mcp.js';
import { render } from './template.js';
import { outputresult, outputresource } from './format.js';
import { createGuardrails } from '@mcp-layer/guardrails';
import { connect } from '@mcp-layer/connect';
import { createPipeline, runPipeline, runSchema, runTransport } from '@mcp-layer/plugin';
import { extract } from '@mcp-layer/schema';
import { executeSession, listSessions, openSession, sessionCatalog, stopAllSessions, stopSession } from '@mcp-layer/stateful';
import { LayerError } from '@mcp-layer/error';

/**
 * Build metadata for help output.
 * @param {{ name: string, version: string, description: string }} base - Base CLI metadata.
 * @param {Record<string, unknown> | undefined} info - Optional server-provided info payload.
 * @param {string | undefined} serverName - Server name resolved from config.
 * @param {string | undefined} banner - Server banner text captured from stderr.
 * @param {string | undefined} instructions - Server-provided usage instructions.
 * @returns {{ name: string, version: string, description: string }}
 */
function servermeta(base, info, serverName, banner, instructions) {
  const name = typeof info?.name === 'string'
    ? info.name
    : serverName || base.name;
  const version = typeof info?.version === 'string'
    ? info.version
    : base.version;
  const cli = base.version;
  if (info) {
    const detail = metadetail(banner, instructions);
    return {
      name,
      version,
      description: `CLI v${cli}.${detail}`
    };
  }
  return {
    name: base.name,
    version: base.version,
    description: `${base.description} (CLI v${cli}).`
  };
}

/**
 * Merge banner and instructions into a single help block.
 * @param {string | undefined} banner - Banner text captured from stderr.
 * @param {string | undefined} instructions - Server-provided help instructions.
 * @returns {string}
 */
function metadetail(banner, instructions) {
  const parts = [];
  if (banner) parts.push(banner.trim());
  if (instructions) parts.push(instructions.trim());
  if (parts.length === 0) return '';
  return `\n\n${parts.join('\n')}`;
}

/**
 * Capture stderr output from a transport to reorder banners in help output.
 * @param {{ stderr?: NodeJS.ReadableStream | null }} transport - Transport exposing a stderr stream.
 * @returns {{ text: () => string, stop: () => void }}
 */
function capturestderr(transport) {
  const stream = transport && transport.stderr;
  if (!stream || typeof stream.on !== 'function') {
    return { text: function text() { return ''; }, stop: function stop() {} };
  }
  const chunks = [];
  /**
   * Collect stderr chunks.
   * @param {Buffer} chunk - Buffer chunk read from stderr.
   * @returns {void}
   */
  function onData(chunk) {
    chunks.push(chunk.toString());
  }
  stream.on('data', onData);
  return {
    text: function text() {
      return chunks.join('');
    },
    stop: function stop() {
      stream.off('data', onData);
    }
  };
}

/**
 * Build a list of items by type.
 * @param {Array<Record<string, unknown>>} items - Schema items to filter.
 * @param {string} type - Target item type to include.
 * @returns {Array<Record<string, unknown>>}
 */
function listbytype(items, type) {
  const list = [];
  for (const item of items) {
    if (item.type === type) list.push(item);
  }
  return list;
}

/**
 * Render a list table or JSON.
 * @param {Array<Record<string, unknown>>} items - Schema items to list.
 * @param {string} type - Item type to render.
 * @param {string | undefined} format - Optional output format override.
 * @param {string[]} headers - Table header labels.
 * @param {(item: Record<string, unknown>) => string[]} maprow - Row mapper for table output.
 * @returns {boolean}
 */
function listitems(items, type, format, headers, maprow) {
  const list = listbytype(items, type);
  if (format === 'json') {
    jsonout(list);
    return true;
  }
  const rows = [];
  for (const item of list) {
    rows.push(maprow(item));
  }
  table(headers, rows);
  return true;
}

/**
 * Find a named item in the schema.
 * @param {Array<Record<string, unknown>>} items - Schema items to search.
 * @param {string} type - Item type to match.
 * @param {string | null} target - Target name or URI.
 * @returns {Record<string, unknown> | undefined}
 */
function finditem(items, type, target) {
  if (!target) return undefined;
  for (const item of items) {
    if (item.type !== type) continue;
    if (type === 'resource') {
      const uri = item.detail && typeof item.detail === 'object' ? item.detail.uri : undefined;
      if (item.name === target || uri === target) return item;
      continue;
    }
    if (item.name === target) return item;
  }
  return undefined;
}

/**
 * Build static help configuration.
 * @param {string} cliName - CLI command name.
 * @param {Array<{ options: { name: string, description: string } }>} custom - Custom command registrations.
 * @returns {{ commands: Array<{ name: string, description: string }>, flags: Record<string, string>, examples: string[] }}
 */
function statichelp(cliName, custom) {
  const commands = [
    { name: 'servers list', description: 'List configured servers.' },
    { name: 'tools list', description: 'List available tools.' },
    { name: 'tools <name>', description: 'Execute a tool.' },
    { name: 'prompts list', description: 'List available prompts.' },
    { name: 'prompts <name>', description: 'Execute a prompt.' },
    { name: 'resources list', description: 'List available resources.' },
    { name: 'resources <uri>', description: 'Read a resource.' },
    { name: 'templates list', description: 'List available resource templates.' },
    { name: 'templates <name>', description: 'Render a resource template.' },
    { name: 'session list', description: 'List tracked stateful sessions.' },
    { name: 'session stop --name <id>', description: 'Stop one tracked session.' },
    { name: 'session stop --all', description: 'Stop all tracked sessions.' },
    { name: 'session [--name <id>] tools <name>', description: 'Execute a tool inside a stateful session.' }
  ];
  const extra = customcommands(custom);
  return {
    commands: commands.concat(extra),
    flags: {
      '--server <name>': 'Select a server from the resolved config.',
      '--config <path>': 'Point at a config file or directory to search.',
      '--transport <mode>': 'Override transport (stdio, streamable-http, or sse) at runtime.',
      '--name <id>': 'Session id for stateful session commands.',
      '--all': 'Apply session stop command to all active sessions.',
      '--format <json>': 'Switch list output to JSON.',
      '--json <string>': 'Provide JSON input for run/render.',
      '--input <path>': 'Provide JSON input from a file.',
      '--raw': 'Emit raw text or binary payloads when possible; fall back to JSON.',
      '--no-markdown': 'Disable markdown rendering for text output.',
      '--allow-ansi': 'Allow ANSI escape sequences in server-provided text.',
      '--no-spinner': 'Disable the loading spinner.'
    },
    examples: [
      `${cliName} servers list --format json`,
      `${cliName} tools list`,
      `${cliName} tools list --server demo`,
      `${cliName} tools echo --text "hello"`,
      `${cliName} tools echo --server demo --text "hello"`,
      `${cliName} prompts kickoff --json '{"topic":"launch"}'`,
      `${cliName} resources ui://dashboard/app.html`,
      `${cliName} templates notes --topic add --detail usage`,
      `${cliName} session tools echo --text "hello"`,
      `${cliName} session --name <session> tools echo --text "hello"`,
      `${cliName} session stop --all`
    ]
  };
}

/**
 * Build custom command entries for main help output.
 * @param {Array<{ options: { name: string, description: string } }>} custom - Custom command registrations.
 * @returns {Array<{ name: string, description: string }>}
 */
function customcommands(custom) {
  const list = [];
  for (const cmd of custom) {
    list.push({ name: cmd.options.name, description: cmd.options.description });
  }
  return list;
}

/**
 * Find a custom command by name.
 * @param {Array<{ options: { name: string }, handler: (argv: Record<string, unknown>) => Promise<void> }>} custom - Custom command registrations.
 * @param {string | undefined} target - Target command name.
 * @returns {{ options: { name: string, description: string, details?: string, flags?: Record<string, string[]>, examples?: string[] }, handler: (argv: Record<string, unknown>) => Promise<void> } | undefined}
 */
function findcustom(custom, target) {
  if (!target) return undefined;
  for (const cmd of custom) {
    if (cmd.options.name === target) return cmd;
  }
  return undefined;
}

/**
 * Normalize a value into a plain object.
 * @param {unknown} value - Input value.
 * @returns {Record<string, unknown>}
 */
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Build a CLI plugin pipeline.
 * @param {{ plugins?: Array<Record<string, unknown>>, guardrails?: Record<string, unknown> }} base - CLI base options.
 * @returns {{ transport: any, schema: any, before: any, after: any, error: any }}
 */
function pipeline(base) {
  const guardrails = createGuardrails(record(base.guardrails));
  const plugins = Array.isArray(base.plugins) ? base.plugins : [];
  return createPipeline({
    plugins: [...guardrails, ...plugins]
  });
}

/**
 * Map command surface to schema item type.
 * @param {'tools' | 'prompts' | 'resources' | 'templates'} surface - Command surface.
 * @returns {'tool' | 'prompt' | 'resource' | 'resource-template'}
 */
function itemtype(surface) {
  if (surface === 'tools') return 'tool';
  if (surface === 'prompts') return 'prompt';
  if (surface === 'resources') return 'resource';
  return 'resource-template';
}

/**
 * Build RPC method and payload for an execution command.
 * @param {'tools' | 'prompts' | 'resources' | 'templates'} surface - Command surface.
 * @param {Record<string, unknown>} item - Target schema item.
 * @param {Record<string, unknown>} args - Resolved input arguments.
 * @returns {{ method: string, params: Record<string, unknown> }}
 */
function operation(surface, item, args) {
  if (surface === 'tools') {
    return {
      method: 'tools/call',
      params: { name: item.name, arguments: args }
    };
  }

  if (surface === 'prompts') {
    return {
      method: 'prompts/get',
      params: { name: item.name, arguments: args }
    };
  }

  if (surface === 'resources') {
    return {
      method: 'resources/read',
      params: { uri: item.detail?.uri }
    };
  }

  return {
    method: 'resources/read',
    params: { uri: render(item.detail?.uriTemplate, args) }
  };
}

/**
 * Resolve metadata for an operation.
 * @param {'tools' | 'prompts' | 'resources' | 'templates'} surface - Command surface.
 * @param {Record<string, unknown>} item - Target schema item.
 * @param {string} sessionId - Session identifier.
 * @returns {Record<string, unknown>}
 */
function operationMeta(surface, item, sessionId) {
  if (surface === 'tools') return { surface, toolName: item.name, sessionId };
  if (surface === 'prompts') return { surface, promptName: item.name, sessionId };
  if (surface === 'resources') return { surface, resourceUri: item.detail?.uri, sessionId };
  return { surface, templateUri: item.detail?.uriTemplate, sessionId };
}

/**
 * Execute an MCP operation using the connected session client.
 * @param {import('@mcp-layer/session').Session} session - Active MCP session.
 * @param {string} method - MCP method name.
 * @param {Record<string, unknown>} params - MCP params.
 * @returns {Promise<unknown>}
 */
async function invoke(session, method, params) {
  if (method === 'tools/call') return session.client.callTool(params);
  if (method === 'prompts/get') return session.client.getPrompt(params);
  if (method === 'resources/read') return session.client.readResource(params);
  return session.client.request({ method, params });
}

/**
 * Run an operation through the plugin pipeline.
 * @param {{ transport: any, schema: any, before: any, after: any, error: any }} pipe - Plugin pipeline.
 * @param {Record<string, unknown>} context - Execution context.
 * @param {(ctx: Record<string, unknown>) => Promise<unknown>} execute - Executor callback.
 * @returns {Promise<unknown>}
 */
async function runop(pipe, context, execute) {
  const transport = await runTransport(pipe, context);
  const state = await runPipeline(pipe, transport, execute);
  return state.result;
}

/**
 * Resolve the session subcommand route.
 * @param {string[]} positionals - Full CLI positionals.
 * @returns {{ kind: 'list' | 'stop' | 'surface' | 'help', command?: { surface: string, action: string, target: string | null } }}
 */
function sessionroute(positionals) {
  const head = positionals[1];
  if (!head) return { kind: 'help' };
  if (head === 'list') return { kind: 'list' };
  if (head === 'stop') return { kind: 'stop' };
  const command = route(positionals.slice(1));
  if (command.surface === 'help') return { kind: 'help' };
  return { kind: 'surface', command };
}

/**
 * Build help text for session commands.
 * @param {string} cliName - CLI command name.
 * @returns {string}
 */
function sessionhelp(cliName) {
  return [
    `${cliName} session list [--format json]`,
    `${cliName} session stop --name <id>`,
    `${cliName} session stop --all`,
    `${cliName} session [--name <id>] tools <name> [options]`,
    `${cliName} session [--name <id>] prompts <name> [options]`,
    `${cliName} session [--name <id>] resources <uri>`,
    `${cliName} session [--name <id>] templates <name> [options]`
  ].join('\n');
}

/**
 * CLI builder interface.
 * @param {{ name?: string, version?: string, description?: string, colors?: boolean, accent?: string, subtle?: string, spinner?: boolean, markdown?: boolean, ansi?: boolean, server?: string, config?: string, showServers?: boolean, plugins?: Array<Record<string, unknown>>, guardrails?: Record<string, unknown> }} [opts] - CLI defaults override.
 * @returns {{ command: (options: { name: string, description: string, details?: string, flags?: Record<string, string[]>, examples?: string[] }, handler: (argv: Record<string, unknown>, helpers: { spinner: (text: string) => () => void }) => Promise<void>) => any, render: (args?: string[]) => Promise<void> }}
 */
export function cli(opts = {}) {
  const custom = [];
  const base = { ...defaults(), ...opts };

  return {
    /**
     * Register a custom command.
     * @param {{ name: string, description: string, details?: string, flags?: Record<string, string[]>, examples?: string[] }} options - Custom command metadata.
     * @param {(argv: Record<string, unknown>, helpers: { spinner: (text: string) => () => void }) => Promise<void>} handler - Command handler invoked with parsed argv.
     * @returns {any}
     */
    command: function command(options, handler) {
      custom.push({ options, handler });
      return this;
    },

    /**
     * Execute the CLI.
     * @param {string[]} [args] - Optional argv override (defaults to process.argv slice).
     * @returns {Promise<void>}
     */
    render: async function render(args) {
      const input = parse(args || process.argv.slice(2));
      const global = globals(input.parsed);
      const inputArgs = Object.keys(input.restParsed).length ? input.restParsed : input.parsed;
      const colors = base.colors && global.colors;
      const markdown = base.markdown && global.markdown;
      const ansi = base.ansi || global.ansi;
      const theme = { accent: base.accent, subtle: base.subtle };
      const tty = Boolean(process.stdout.isTTY);
      const cliName = base.name || 'mcp-layer';
      const pipe = pipeline(base);

      if (global.version) {
        process.stdout.write(`${base.name} ${base.version}\n`);
        return;
      }

      const customcmd = findcustom(custom, input.positionals[0]);

      if (customcmd && global.help) {
        const meta = servermeta(base, undefined, undefined, undefined, undefined);
        process.stdout.write(`${commandhelp(customcmd.options, meta, colors, theme, cliName)}\n`);
        return;
      }

      if (customcmd) {
        const helpers = {
          spinner: function spinner(text) {
            const gate = spin(base.spinner && global.spinner, text);
            gate.start();
            return function stop() {
              gate.stop();
            };
          }
        };
        await customcmd.handler(input.parsed, helpers);
        return;
      }

      const cmd = route(input.positionals);

      if (input.positionals[0] === 'session') {
        const sessionCmd = sessionroute(input.positionals);

        if (global.help || sessionCmd.kind === 'help') {
          process.stdout.write(`${sessionhelp(cliName)}\n`);
          return;
        }

        if (sessionCmd.kind === 'list') {
          const sessions = await listSessions();
          if (global.format === 'json') {
            jsonout(sessions);
            return;
          }

          const rows = sessions.map(function row(item) {
            return [
              String(item.id ?? ''),
              String(item.serverName ?? ''),
              String(item.status ?? ''),
              String(item.lastActiveAt ?? '')
            ];
          });
          table(['Session', 'Server', 'Status', 'Last Active'], rows);
          return;
        }

        if (sessionCmd.kind === 'stop') {
          const all = input.parsed.all === true;
          const named = typeof input.parsed.name === 'string' && input.parsed.name.length > 0
            ? input.parsed.name
            : undefined;

          if (all) {
            const stopped = await stopAllSessions();
            if (global.format === 'json') {
              jsonout(stopped);
              return;
            }
            process.stdout.write(`Stopped ${stopped.stopped} session(s).\n`);
            return;
          }

          if (named) {
            const stopped = await stopSession({ name: named });
            if (global.format === 'json') {
              jsonout(stopped);
              return;
            }
            process.stdout.write(`Stopped session ${stopped.id}.\n`);
            return;
          }

          const sessions = await listSessions();
          const active = sessions.filter(function onlyActive(item) {
            return item.status === 'active';
          });

          if (active.length !== 1) {
            throw new LayerError({
              name: 'cli',
              method: 'cli.render',
              message: 'session stop is ambiguous with {count} active sessions. Use --name <id> or --all.',
              vars: { count: String(active.length) },
              code: 'SESSION_STOP_AMBIGUOUS'
            });
          }

          const stopped = await stopSession({ name: String(active[0].id) });
          if (global.format === 'json') {
            jsonout(stopped);
            return;
          }
          process.stdout.write(`Stopped session ${stopped.id}.\n`);
          return;
        }

        const sessionName = typeof input.parsed.name === 'string' && input.parsed.name.length > 0
          ? input.parsed.name
          : undefined;
        const opened = await openSession({
          name: sessionName,
          server: global.server || base.server,
          config: global.config || base.config,
          transport: global.transport
        });
        const sessionId = String(opened.id);

        if (opened.generated === true) {
          process.stderr.write(`Session started: ${sessionId}\n`);
        }

        const fetched = await sessionCatalog({ name: sessionId });
        const shaped = await runSchema(pipe, {
          surface: 'schema',
          method: 'schema/extract',
          sessionId,
          serverName: String(opened.server ?? ''),
          catalog: fetched,
          meta: { scope: 'session' }
        });
        const output = record(shaped.catalog);
        const items = Array.isArray(output.items) ? output.items : [];
        const exec = sessionCmd.command;

        if (!exec || !['tools', 'prompts', 'resources', 'templates'].includes(exec.surface)) {
          throw new LayerError({
            name: 'cli',
            method: 'cli.render',
            message: 'Unknown session command.'
          });
        }

        if (exec.action === 'list') {
          if (exec.surface === 'tools') {
            listitems(items, 'tool', global.format, ['Tool', 'Description'], function maptool(item) {
              return [item.name, item.description || ''];
            });
            return;
          }

          if (exec.surface === 'prompts') {
            listitems(items, 'prompt', global.format, ['Prompt', 'Description'], function mapprompt(item) {
              return [item.name, item.description || ''];
            });
            return;
          }

          if (exec.surface === 'resources') {
            listitems(items, 'resource', global.format, ['Resource', 'Description'], function mapresource(item) {
              return [item.detail?.uri || '', item.description || ''];
            });
            return;
          }

          listitems(items, 'resource-template', global.format, ['Template', 'Description'], function maptemplate(item) {
            return [item.detail?.uriTemplate || '', item.description || ''];
          });
          return;
        }

        const type = itemtype(/** @type {'tools' | 'prompts' | 'resources' | 'templates'} */ (exec.surface));
        const item = finditem(items, type, exec.target);
        if (!item) {
          throw new LayerError({
            name: 'cli',
            method: 'cli.render',
            message: 'Unknown session target "{target}".',
            vars: { target: exec.target ?? '' }
          });
        }

        const surface = /** @type {'tools' | 'prompts' | 'resources' | 'templates'} */ (exec.surface);
        const args = surface === 'resources'
          ? {}
          : await inputs(global, input.parsed, inputArgs, item);
        const call = operation(surface, item, args);
        const meta = operationMeta(surface, item, sessionId);

        const result = await runop(
          pipe,
          {
            surface,
            method: call.method,
            params: call.params,
            sessionId,
            serverName: String(opened.server ?? ''),
            meta
          },
          async function invoke(current) {
            const response = await executeSession({
              name: sessionId,
              method: String(current.method),
              params: record(current.params),
              meta: record(current.meta)
            });
            return response.result;
          }
        );

        if (surface === 'resources' || surface === 'templates') {
          if (global.format === 'json') {
            jsonout({
              session: {
                id: sessionId,
                generated: Boolean(opened.generated),
                reused: Boolean(opened.reused)
              },
              result
            });
            return;
          }
          await outputresource(record(result), { raw: global.raw, markdown, ansi, tty, colors, theme });
          return;
        }

        await outputresult(record(result), { raw: global.raw, markdown, ansi, tty, colors, theme });
        return;
      }

      if (global.help && cmd.target && (cmd.surface === 'tools' || cmd.surface === 'prompts' || cmd.surface === 'resources' || cmd.surface === 'templates')) {
        const info = await select({ server: global.server || base.server, config: global.config || base.config });
        const transport = await runTransport(pipe, {
          surface: 'transport',
          method: 'transport/connect',
          sessionId: info.name,
          serverName: info.name,
          params: { transport: global.transport },
          meta: { scope: 'help-item' }
        });
        const mode = typeof transport.params?.transport === 'string'
          ? transport.params.transport
          : global.transport;
        const gate = spin(base.spinner && global.spinner, spinnertext(info.name));
        gate.start();
        const session = await connect(info.config, info.name, { stderr: 'pipe', transport: mode });
        const stderr = capturestderr(session.transport);
        try {
          const fetched = await extract(session);
          const shaped = await runSchema(pipe, {
            surface: 'schema',
            method: 'schema/extract',
            sessionId: info.name,
            serverName: info.name,
            catalog: fetched,
            meta: { scope: 'help-item' }
          });
          const output = record(shaped.catalog);
          const items = Array.isArray(output.items) ? output.items : [];
          const type = cmd.surface === 'templates' ? 'resource-template' : cmd.surface.slice(0, -1);
          const item = finditem(items, type, cmd.target);
          if (!item) {
            throw new LayerError({
              name: 'cli',
              method: 'cli.render',
              message: 'Unknown "{targetType}" target "{targetName}".',
              vars: { targetType: cmd.surface.slice(0, -1), targetName: cmd.target ?? '' }
            });
          }
          const banner = stderr.text().trim();
          const meta = servermeta(base, output.server?.info, info.name, banner, output.server?.instructions);
          process.stdout.write(`${itemhelp(item, info.name, meta, colors, theme, cliName, tty)}\n`);
          return;
        } finally {
          gate.stop();
          stderr.stop();
          await session.close();
        }
      }

      if (global.help || cmd.surface === 'help') {
        const staticInfo = statichelp(cliName, custom);
        let cfg = null;
        try {
          cfg = await configload(global.config || base.config);
        } catch {
          cfg = null;
        }
        const showServers = Boolean(base.showServers);
        const servers = showServers ? serverhelp(cfg) : [];
        let meta = servermeta(base, undefined, undefined, undefined, undefined);
        const extras = [];
        if (cfg) {
          try {
            const info = await select({ server: global.server || base.server, config: global.config || base.config });
            const transport = await runTransport(pipe, {
              surface: 'transport',
              method: 'transport/connect',
              sessionId: info.name,
              serverName: info.name,
              params: { transport: global.transport },
              meta: { scope: 'help-main' }
            });
            const mode = typeof transport.params?.transport === 'string'
              ? transport.params.transport
              : global.transport;
            const gate = spin(base.spinner && global.spinner, spinnertext(info.name));
            gate.start();
            const session = await connect(info.config, info.name, { stderr: 'pipe', transport: mode });
            const stderr = capturestderr(session.transport);
            try {
              const fetched = await extract(session);
              const shaped = await runSchema(pipe, {
                surface: 'schema',
                method: 'schema/extract',
                sessionId: info.name,
                serverName: info.name,
                catalog: fetched,
                meta: { scope: 'help-main' }
              });
              const output = record(shaped.catalog);
              const items = Array.isArray(output.items) ? output.items : [];
              const banner = stderr.text().trim();
              meta = servermeta(base, output.server?.info, info.name, banner, output.server?.instructions);
              addsection(extras, 'Tools', toolhelp(items, info.name, colors, theme, cliName, tty));
              addsection(extras, 'Prompts', prompthelp(items, info.name, colors, theme, cliName, tty));
              addsection(extras, 'Resources', resourcehelp(items, info.name, colors, theme, cliName, tty));
              addsection(extras, 'Templates', templatehelp(items, info.name, colors, theme, cliName, tty));
            } finally {
              gate.stop();
              stderr.stop();
              await session.close();
            }
          } catch {
            // Fall back to static help when we cannot resolve a server.
          }
        }
        const preferExtras = extras.length > 0;
        process.stdout.write(`${mainhelp(meta, staticInfo.commands, staticInfo.flags, staticInfo.examples, servers, extras, preferExtras, colors, theme, cliName)}\n`);
        return;
      }

      if (cmd.surface === 'servers' && cmd.action === 'list') {
        const cfg = await configload(global.config || base.config);
        const rows = [];
        for (const [name, entry] of cfg.map.entries()) {
          rows.push([name, entry.source]);
        }
        if (global.format === 'json') {
          jsonout(rows.map(function maprow(row) {
            return { name: row[0], source: row[1] };
          }));
          return;
        }
        table(['Name', 'Source'], rows);
        return;
      }

      const data = await catalog({
        server: global.server || base.server,
        config: global.config || base.config,
        spinner: base.spinner && global.spinner,
        transport: global.transport,
        pipeline: pipe,
        meta: { scope: 'command' }
      });
      const session = data.session;
      const items = Array.isArray(data.output.items) ? data.output.items : [];

      try {
        if (cmd.surface === 'tools' && cmd.action === 'list') {
          listitems(items, 'tool', global.format, ['Tool', 'Description'], function maptool(item) {
            return [item.name, item.description || ''];
          });
          return;
        }

        if (cmd.surface === 'prompts' && cmd.action === 'list') {
          listitems(items, 'prompt', global.format, ['Prompt', 'Description'], function mapprompt(item) {
            return [item.name, item.description || ''];
          });
          return;
        }

        if (cmd.surface === 'resources' && cmd.action === 'list') {
          listitems(items, 'resource', global.format, ['Resource', 'Description'], function mapresource(item) {
            return [item.detail?.uri || '', item.description || ''];
          });
          return;
        }

        if (cmd.surface === 'templates' && cmd.action === 'list') {
          listitems(items, 'resource-template', global.format, ['Template', 'Description'], function maptemplate(item) {
            return [item.detail?.uriTemplate || '', item.description || ''];
          });
          return;
        }

        if (cmd.surface === 'tools' && cmd.action === 'exec') {
          const tool = finditem(items, 'tool', cmd.target);
          if (!tool) {
            throw new LayerError({
              name: 'cli',
              method: 'cli.render',
              message: 'Unknown tool "{toolName}".',
              vars: { toolName: cmd.target ?? '' }
            });
          }
          const args = await inputs(global, input.parsed, inputArgs, tool);
          const call = operation('tools', tool, args);
          const result = await runop(
            pipe,
            {
              surface: 'tools',
              method: call.method,
              params: call.params,
              sessionId: session.name,
              serverName: session.name,
              meta: operationMeta('tools', tool, session.name)
            },
            async function execute(current) {
              return invoke(session, String(current.method), record(current.params));
            }
          );
          await outputresult(record(result), { raw: global.raw, markdown, ansi, tty, colors, theme });
          return;
        }

        if (cmd.surface === 'prompts' && cmd.action === 'exec') {
          const prompt = finditem(items, 'prompt', cmd.target);
          if (!prompt) {
            throw new LayerError({
              name: 'cli',
              method: 'cli.render',
              message: 'Unknown prompt "{promptName}".',
              vars: { promptName: cmd.target ?? '' }
            });
          }
          const args = await inputs(global, input.parsed, inputArgs, prompt);
          const call = operation('prompts', prompt, args);
          const result = await runop(
            pipe,
            {
              surface: 'prompts',
              method: call.method,
              params: call.params,
              sessionId: session.name,
              serverName: session.name,
              meta: operationMeta('prompts', prompt, session.name)
            },
            async function execute(current) {
              return invoke(session, String(current.method), record(current.params));
            }
          );
          await outputresult(record(result), { raw: global.raw, markdown, ansi, tty, colors, theme });
          return;
        }

        if (cmd.surface === 'resources' && cmd.action === 'exec') {
          const resource = finditem(items, 'resource', cmd.target);
          if (!resource) {
            throw new LayerError({
              name: 'cli',
              method: 'cli.render',
              message: 'Unknown resource "{resourceUri}".',
              vars: { resourceUri: cmd.target ?? '' }
            });
          }
          const call = operation('resources', resource, {});
          const result = await runop(
            pipe,
            {
              surface: 'resources',
              method: call.method,
              params: call.params,
              sessionId: session.name,
              serverName: session.name,
              meta: operationMeta('resources', resource, session.name)
            },
            async function execute(current) {
              return invoke(session, String(current.method), record(current.params));
            }
          );
          if (global.format === 'json') {
            jsonout(result);
            return;
          }
          await outputresource(record(result), { raw: global.raw, markdown, ansi, tty, colors, theme });
          return;
        }

        if (cmd.surface === 'templates' && cmd.action === 'exec') {
          const template = finditem(items, 'resource-template', cmd.target);
          if (!template) {
            throw new LayerError({
              name: 'cli',
              method: 'cli.render',
              message: 'Unknown template "{templateUri}".',
              vars: { templateUri: cmd.target ?? '' }
            });
          }
          const args = await inputs(global, input.parsed, inputArgs, template);
          const call = operation('templates', template, args);
          const result = await runop(
            pipe,
            {
              surface: 'templates',
              method: call.method,
              params: call.params,
              sessionId: session.name,
              serverName: session.name,
              meta: operationMeta('templates', template, session.name)
            },
            async function execute(current) {
              return invoke(session, String(current.method), record(current.params));
            }
          );
          if (global.format === 'json') {
            jsonout(result);
            return;
          }
          await outputresource(record(result), { raw: global.raw, markdown, ansi, tty, colors, theme });
          return;
        }

        throw new LayerError({
          name: 'cli',
          method: 'cli.render',
          message: 'Unknown command "{command}".',
          vars: { command: cmd.surface }
        });
      } finally {
        await session.close();
      }
    }
  };
}
