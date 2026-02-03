import { defaults, configload, select } from './config.js';
import { parse, globals, route } from './argv.js';
import { mainhelp, serverhelp, toolhelp, prompthelp, resourcehelp, templatehelp, addsection, itemhelp } from './help-system.js';
import { table, jsonout } from './output.js';
import { inputs } from './inputs.js';
import { catalog, spinner as spin } from './mcp.js';
import { render } from './template.js';
import { connect } from '@mcp-layer/connect';
import { extract } from '@mcp-layer/schema';

/**
 * Build metadata for help output.
 * @param {{ name: string, version: string, description: string }} base
 * @param {Record<string, unknown> | undefined} info
 * @param {string | undefined} serverName
 * @param {string | undefined} banner
 * @param {string | undefined} instructions
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
 * @param {string | undefined} banner
 * @param {string | undefined} instructions
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
 * @param {{ stderr?: NodeJS.ReadableStream | null }} transport
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
   * @param {Buffer} chunk
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
 * @param {Array<Record<string, unknown>>} items
 * @param {string} type
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
 * @param {Array<Record<string, unknown>>} items
 * @param {string} type
 * @param {string | undefined} format
 * @param {string[]} headers
 * @param {(item: Record<string, unknown>) => string[]} maprow
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
 * @param {Array<Record<string, unknown>>} items
 * @param {string} type
 * @param {string | null} target
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
 * @returns {{ commands: Array<{ name: string, description: string }>, flags: Record<string, string>, examples: string[] }}
 */
function statichelp() {
  return {
    commands: [
      { name: 'servers list', description: 'List configured servers.' },
      { name: 'tools list', description: 'List available tools.' },
      { name: 'tools <name>', description: 'Execute a tool.' },
      { name: 'prompts list', description: 'List available prompts.' },
      { name: 'prompts <name>', description: 'Execute a prompt.' },
      { name: 'resources list', description: 'List available resources.' },
      { name: 'resources <uri>', description: 'Read a resource.' },
      { name: 'templates list', description: 'List available resource templates.' },
      { name: 'templates <name>', description: 'Render a resource template.' }
    ],
    flags: {
      '--server <name>': 'Select a server from the resolved config.',
      '--config <path>': 'Point at a config file or directory to search.',
      '--format <json>': 'Switch list output to JSON.',
      '--json <string>': 'Provide JSON input for run/render.',
      '--input <path>': 'Provide JSON input from a file.',
      '--no-spinner': 'Disable the loading spinner.'
    },
    examples: [
      'mcp-layer servers list --format json',
      'mcp-layer tools list',
      'mcp-layer tools list --server demo',
      'mcp-layer tools echo --text "hello"',
      'mcp-layer tools echo --server demo --text "hello"',
      'mcp-layer prompts kickoff --json \'{"topic":"launch"}\'',
      'mcp-layer resources ui://dashboard/app.html',
      'mcp-layer templates notes --topic add --detail usage'
    ]
  };
}

/**
 * CLI builder interface.
 * @param {{ name?: string, version?: string, description?: string, colors?: boolean, accent?: string, subtle?: string, spinner?: boolean, server?: string, config?: string }} [opts]
 * @returns {{ command: (options: { name: string, description: string, details?: string, flags?: Record<string, string[]>, examples?: string[] }, handler: (argv: Record<string, unknown>) => Promise<void>) => any, render: (args?: string[]) => Promise<void> }}
 */
export function cli(opts = {}) {
  const custom = [];
  const base = { ...defaults(), ...opts };

  return {
    /**
     * Register a custom command.
     * @param {{ name: string, description: string, details?: string, flags?: Record<string, string[]>, examples?: string[] }} options
     * @param {(argv: Record<string, unknown>) => Promise<void>} handler
     * @returns {any}
     */
    command: function command(options, handler) {
      custom.push({ options, handler });
      return this;
    },

    /**
     * Execute the CLI.
     * @param {string[]} [args]
     * @returns {Promise<void>}
     */
    render: async function render(args) {
      const input = parse(args || process.argv.slice(2));
      const global = globals(input.parsed);
      const inputArgs = Object.keys(input.restParsed).length ? input.restParsed : input.parsed;
      const colors = base.colors && global.colors;
      const theme = { accent: base.accent, subtle: base.subtle };

      if (global.version) {
        process.stdout.write(`${base.name} ${base.version}\n`);
        return;
      }

      const cmd = route(input.positionals);

        if (global.help && cmd.target && (cmd.surface === 'tools' || cmd.surface === 'prompts' || cmd.surface === 'resources' || cmd.surface === 'templates')) {
          const info = await select({ server: global.server || base.server, config: global.config || base.config });
          const gate = spin(base.spinner && global.spinner, 'Loading MCP schema');
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
            process.stdout.write(`${itemhelp(item, info.name, meta, colors, theme)}\n`);
            return;
          } finally {
            gate.stop();
            stderr.stop();
            await session.close();
          }
        }

      if (global.help || cmd.surface === 'help') {
        const staticInfo = statichelp();
        let cfg = null;
        try {
          cfg = await configload(global.config || base.config);
        } catch {
          cfg = null;
        }
        const servers = serverhelp(cfg);
        let meta = servermeta(base, undefined, undefined, undefined, undefined);
        const extras = [];
        if (cfg) {
          try {
            const info = await select({ server: global.server || base.server, config: global.config || base.config });
            const gate = spin(base.spinner && global.spinner, 'Loading MCP schema');
            gate.start();
            const session = await connect(info.config, info.name, { stderr: 'pipe' });
            const stderr = capturestderr(session.transport);
            try {
              const output = await extract(session);
              const banner = stderr.text().trim();
              meta = servermeta(base, output.server.info, info.name, banner, output.server.instructions);
              addsection(extras, 'Tools', toolhelp(output.items, info.name, colors, theme));
              addsection(extras, 'Prompts', prompthelp(output.items, info.name, colors, theme));
              addsection(extras, 'Resources', resourcehelp(output.items, info.name, colors, theme));
              addsection(extras, 'Templates', templatehelp(output.items, info.name, colors, theme));
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
        process.stdout.write(`${mainhelp(meta, staticInfo.commands, staticInfo.flags, staticInfo.examples, servers, extras, preferExtras, colors, theme)}\n`);
        return;
      }

      for (const cmddef of custom) {
        if (cmddef.options.name === cmd.surface) {
          await cmddef.handler(input.parsed);
          return;
        }
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
          jsonout(result);
          return;
        }

        if (cmd.surface === 'prompts' && cmd.action === 'exec') {
          const prompt = finditem(items, 'prompt', cmd.target);
          if (!prompt) {
            throw new Error(`Unknown prompt: ${cmd.target}`);
          }
          const args = await inputs(global, input.parsed, inputArgs, prompt);
          const result = await session.client.getPrompt({ name: prompt.name, arguments: args });
          jsonout(result);
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
          const text = result.contents?.[0]?.text;
          process.stdout.write(`${text || JSON.stringify(result, null, 2)}\n`);
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
          const text = result.contents?.[0]?.text;
          process.stdout.write(`${text || JSON.stringify(result, null, 2)}\n`);
          return;
        }

        throw new Error(`Unknown command: ${cmd.surface}`);
      } finally {
        await session.close();
      }
    }
  };
}
