import { defaults, configload, select } from './config.js';
import { parse, globals, route } from './argv.js';
import { mainhelp, serverhelp, toolhelp, prompthelp, resourcehelp, templatehelp, addsection, itemhelp, commandhelp } from './help-system.js';
import { table, jsonout } from './output.js';
import { inputs } from './inputs.js';
import { catalog, spinner as spin, spinnertext } from './mcp.js';
import { render } from './template.js';
import { outputresult, outputresource } from './format.js';
import { connect } from '@mcp-layer/connect';
import { extract } from '@mcp-layer/schema';

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
  if (banner) {
    parts.push(banner.trim());
  }
  if (instructions) {
    parts.push(instructions.trim());
  }
  if (parts.length === 0) {
    return '';
  }
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
    if (item.type === type) {
      list.push(item);
    }
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
  if (!target) {
    return undefined;
  }
  for (const item of items) {
    if (item.type !== type) {
      continue;
    }
    if (type === 'resource') {
      const uri = item.detail && typeof item.detail === 'object' ? item.detail.uri : undefined;
      if (item.name === target || uri === target) {
        return item;
      }
      continue;
    }
    if (item.name === target) {
      return item;
    }
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
    { name: 'templates <name>', description: 'Render a resource template.' }
  ];
  const extra = customcommands(custom);
  return {
    commands: commands.concat(extra),
    flags: {
      '--server <name>': 'Select a server from the resolved config.',
      '--config <path>': 'Point at a config file or directory to search.',
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
      `${cliName} templates notes --topic add --detail usage`
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
  if (!target) {
    return undefined;
  }
  for (const cmd of custom) {
    if (cmd.options.name === target) {
      return cmd;
    }
  }
  return undefined;
}

/**
 * CLI builder interface.
 * @param {{ name?: string, version?: string, description?: string, colors?: boolean, accent?: string, subtle?: string, spinner?: boolean, markdown?: boolean, ansi?: boolean, server?: string, config?: string, showServers?: boolean }} [opts] - CLI defaults override.
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

      if (global.help && cmd.target && (cmd.surface === 'tools' || cmd.surface === 'prompts' || cmd.surface === 'resources' || cmd.surface === 'templates')) {
        const info = await select({ server: global.server || base.server, config: global.config || base.config });
        const gate = spin(base.spinner && global.spinner, spinnertext(info.name));
        gate.start();
        const session = await connect(info.config, info.name, { stderr: 'pipe' });
        const stderr = capturestderr(session.transport);
        try {
          const output = await extract(session);
          const type = cmd.surface === 'templates' ? 'resource-template' : cmd.surface.slice(0, -1);
          const item = finditem(output.items, type, cmd.target);
          if (!item) {
            throw new Error(`Unknown ${cmd.surface.slice(0, -1)}: ${cmd.target}`);
          }
          const banner = stderr.text().trim();
          const meta = servermeta(base, output.server.info, info.name, banner, output.server.instructions);
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
            const gate = spin(base.spinner && global.spinner, spinnertext(info.name));
            gate.start();
            const session = await connect(info.config, info.name, { stderr: 'pipe' });
            const stderr = capturestderr(session.transport);
            try {
              const output = await extract(session);
              const banner = stderr.text().trim();
              meta = servermeta(base, output.server.info, info.name, banner, output.server.instructions);
              addsection(extras, 'Tools', toolhelp(output.items, info.name, colors, theme, cliName, tty));
              addsection(extras, 'Prompts', prompthelp(output.items, info.name, colors, theme, cliName, tty));
              addsection(extras, 'Resources', resourcehelp(output.items, info.name, colors, theme, cliName, tty));
              addsection(extras, 'Templates', templatehelp(output.items, info.name, colors, theme, cliName, tty));
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

      const data = await catalog({ server: global.server || base.server, config: global.config || base.config, spinner: base.spinner && global.spinner });
      const session = data.session;
      const items = data.output.items;

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
            throw new Error(`Unknown tool: ${cmd.target}`);
          }
          const args = await inputs(global, input.parsed, inputArgs, tool);
          const result = await session.client.callTool({ name: tool.name, arguments: args });
          await outputresult(result, { raw: global.raw, markdown, ansi, tty, colors, theme });
          return;
        }

        if (cmd.surface === 'prompts' && cmd.action === 'exec') {
          const prompt = finditem(items, 'prompt', cmd.target);
          if (!prompt) {
            throw new Error(`Unknown prompt: ${cmd.target}`);
          }
          const args = await inputs(global, input.parsed, inputArgs, prompt);
          const result = await session.client.getPrompt({ name: prompt.name, arguments: args });
          await outputresult(result, { raw: global.raw, markdown, ansi, tty, colors, theme });
          return;
        }

        if (cmd.surface === 'resources' && cmd.action === 'exec') {
          const resource = finditem(items, 'resource', cmd.target);
          if (!resource) {
            throw new Error(`Unknown resource: ${cmd.target}`);
          }
          const result = await session.client.readResource({ uri: resource.detail.uri });
          if (global.format === 'json') {
            jsonout(result);
            return;
          }
          await outputresource(result, { raw: global.raw, markdown, ansi, tty, colors, theme });
          return;
        }

        if (cmd.surface === 'templates' && cmd.action === 'exec') {
          const template = finditem(items, 'resource-template', cmd.target);
          if (!template) {
            throw new Error(`Unknown template: ${cmd.target}`);
          }
          const args = await inputs(global, input.parsed, inputArgs, template);
          const uri = render(template.detail?.uriTemplate, args);
          const result = await session.client.readResource({ uri });
          if (global.format === 'json') {
            jsonout(result);
            return;
          }
          await outputresource(result, { raw: global.raw, markdown, ansi, tty, colors, theme });
          return;
        }

        throw new Error(`Unknown command: ${cmd.surface}`);
      } finally {
        await session.close();
      }
    }
  };
}
