import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import { palette, usecolors } from './colors.js';
import { header, section, wrap } from './help-render.js';

let markdownReady = false;

/**
 * Configure marked-terminal for help descriptions.
 * @returns {void}
 */
function setupmarkdown() {
  if (markdownReady) {
    return;
  }
  marked.use(markedTerminal());
  markdownReady = true;
}

/**
 * Determine if a description string appears to include Markdown.
 * @param {string} text - Description text to inspect.
 * @returns {boolean}
 */
function ismarkdown(text) {
  const sample = text.trim();
  return /^#{1,6}\s/.test(sample)
    || /```/.test(sample)
    || /\*\*[^*]+\*\*/.test(sample)
    || /^\s*-\s+/.test(sample)
    || /^\s*\d+\.\s+/.test(sample);
}

/**
 * Render description text with optional Markdown formatting.
 * @param {string | undefined} text - Description text to render.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {boolean} tty - Whether stdout is a TTY.
 * @returns {string}
 */
function renderdesc(text, colors, tty) {
  if (!text) {
    return '';
  }
  if (!usecolors(colors) || !tty || !ismarkdown(text)) {
    return text;
  }
  setupmarkdown();
  const output = marked.parse(text);
  return String(output).trimEnd();
}

/**
 * Build help text for the CLI.
 * @param {{ name: string, version: string, description: string }} meta - CLI metadata for the header.
 * @param {Array<{ name: string, description: string }>} cmds - Command list for help output.
 * @param {Record<string, string>} flags - Global flag descriptions.
 * @param {string[]} examples - Example usage lines.
 * @param {Array<{ name: string, description: string }>} servers - Configured server entries.
 * @param {Array<{ title: string, list: Array<{ name: string, description: string }> }>} extras - Dynamic help sections.
 * @param {boolean} preferExtras - Whether to show dynamic sections first.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {{ accent: string, subtle: string }} theme - Color theme configuration.
 * @param {string} cliName - CLI name for usage examples.
 * @returns {string}
 */
export function mainhelp(meta, cmds, flags, examples, servers, extras, preferExtras, colors, theme, cliName) {
  const out = [];
  out.push(header(meta, theme, colors));
  out.push('');
  if (preferExtras && extras.length > 0) {
    out.push(formatextras(extras, colors, theme));
    out.push('');
  }
  out.push(section('Usage', [`${cliName} <command> [options]`], theme, colors));
  out.push('');
  out.push(section('Commands', listcmds(cmds), theme, colors));
  out.push('');
  out.push(section('Options', listflags(flags, colors, theme), theme, colors));
  out.push('');
  out.push(section('Examples', listexamples(examples), theme, colors));
  if (servers.length > 0) {
    out.push('');
    out.push(section('Servers', listservers(servers), theme, colors));
  }
  return out.join('\n');
}

/**
 * Render dynamic help sections without truncation.
 * @param {Array<{ title: string, list: Array<{ name: string, description: string }> }>} extras - Dynamic help sections.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {{ accent: string, subtle: string }} theme - Color theme configuration.
 * @returns {string}
 */
function formatextras(extras, colors, theme) {
  const color = palette(colors, theme);
  const blocks = [];
  for (const section of extras) {
    const lines = [];
    lines.push(color.title(`${section.title}:`));
    for (const item of section.list) {
      lines.push(`  ${color.title(item.name)}`);
      const parts = String(item.description).split('\n');
      for (const part of parts) {
        if (part.trim().length === 0) {
          continue;
        }
        lines.push(`    ${part}`);
      }
      lines.push('');
    }
    blocks.push(lines.join('\n').trimEnd());
  }
  return blocks.join('\n\n');
}

/**
 * Build server entries for help output.
 * @param {import('@mcp-layer/config').Config | null} cfg
 * @returns {Array<{ name: string, description: string }>}
 */
export function serverhelp(cfg) {
  if (!cfg) {
    return [{ name: 'No config', description: 'Run with --config or configure an MCP client.' }];
  }
  const list = [];
  for (const [name, entry] of cfg.map.entries()) {
    list.push({ name, description: entry.source });
  }
  if (list.length === 0) {
    list.push({ name: 'No servers found', description: 'Add servers to your MCP client config.' });
  }
  return list;
}

/**
 * Extract template variables from a uriTemplate string.
 * @param {string | undefined} template
 * @returns {string[]}
 */
function templatevars(template) {
  if (!template) {
    return [];
  }
  const vars = new Set();
  const matches = template.match(/\{([^}]+)\}/g) || [];
  for (const match of matches) {
    const name = match.slice(1, -1);
    if (name) {
      vars.add(name);
    }
  }
  return Array.from(vars);
}

/**
 * Format a JSON schema type for help output.
 * @param {unknown} value
 * @returns {string}
 */
function schematype(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.filter(function onlyString(entry) {
      return typeof entry === 'string';
    }).join('|');
  }
  return 'unknown';
}

/**
 * Build a flag description for schema inputs.
 * @param {string} name
 * @param {Record<string, unknown>} schema
 * @param {boolean} required
 * @returns {{ text: string, type: string, required: boolean }}
 */
function flagdetail(name, schema, required) {
  const desc = typeof schema.description === 'string'
    ? schema.description
    : typeof schema.title === 'string'
      ? schema.title
      : 'Input parameter';
  const type = schematype(schema.type);
  return { text: desc, type, required };
}

/**
 * Extract input flags from an item schema.
 * @param {Record<string, unknown>} item
 * @returns {Array<{ name: string, text: string, type: string, required: boolean }>}
 */
function inputflags(item) {
  const schema = item.detail && typeof item.detail === 'object' && item.detail.input && typeof item.detail.input === 'object'
    ? item.detail.input.json
    : undefined;
  if (!schema || typeof schema !== 'object') {
    return [];
  }
  const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const flags = [];
  for (const [name, value] of Object.entries(props)) {
    if (value && typeof value === 'object') {
      const detail = flagdetail(name, value, required.includes(name));
      flags.push({ name: `--${name}`, text: detail.text, type: detail.type, required: detail.required });
    }
  }
  return flags;
}

/**
 * Build an example CLI invocation for a schema item.
 * @param {string} verb
 * @param {string} name
 * @param {Array<{ name: string, text: string, type: string, required: boolean }>} flags
 * @param {string | undefined} serverName
 * @returns {string}
 */
function exampleline(verb, name, flags, serverName, cliName) {
  const samples = flags.slice(0, 2).map(function mapFlag(flag) {
    return `${flag.name} ${valuehint(flag)}`;
  });
  const server = serverName ? ` --server ${serverName}` : '';
  const args = samples.length ? ` ${samples.join(' ')}` : '';
  return `Example: ${cliName} ${verb} ${name}${server}${args}`;
}

/**
 * Choose an example value placeholder based on type.
 * @param {{ type: string }} flag
 * @returns {string}
 */
function valuehint(flag) {
  if (typeof flag.type === 'string' && (flag.type.includes('array') || flag.type.includes('object'))) {
    return '<json>';
  }
  return '<value>';
}

/**
 * Check if any flag type includes a token.
 * @param {Array<{ name: string, text: string, type: string, required: boolean }>} flags
 * @param {string} token
 * @returns {boolean}
 */
function hasflagtype(flags, token) {
  for (const flag of flags) {
    if (typeof flag.type === 'string' && flag.type.includes(token)) {
      return true;
    }
  }
  return false;
}

/**
 * Find the first flag name matching a token.
 * @param {Array<{ name: string, text: string, type: string, required: boolean }>} flags
 * @param {string} token
 * @returns {string}
 */
function firstflag(flags, token) {
  for (const flag of flags) {
    if (typeof flag.type === 'string' && flag.type.includes(token)) {
      return flag.name;
    }
  }
  return '--param';
}

/**
 * Build input syntax notes for per-command help.
 * @param {Array<{ name: string, text: string, type: string, required: boolean }>} flags
 * @returns {string[]}
 */
function inputsyntax(flags) {
  const hasObject = hasflagtype(flags, 'object');
  const hasArray = hasflagtype(flags, 'array');
  if (!hasObject && !hasArray) {
    return [];
  }
  const lines = [];
  if (hasObject) {
    const name = firstflag(flags, 'object');
    lines.push('  Object inputs:');
    lines.push(`    ${name}.key <value>`);
    lines.push(`    ${name} '{"key":"value"}'`);
  }
  if (hasArray) {
    const name = firstflag(flags, 'array');
    lines.push('  Array inputs:');
    lines.push(`    ${name} <value> ${name} <value>`);
    lines.push(`    ${name} '["one","two"]'`);
  }
  return lines;
}

/**
 * Build flag descriptors for any schema item.
 * @param {Record<string, unknown>} item
 * @returns {Array<{ name: string, text: string, type: string, required: boolean }>}
 */
function itemflags(item) {
  if (item.type === 'resource') {
    return [];
  }
  if (item.type === 'resource-template') {
    const vars = templatevars(item.detail && typeof item.detail === 'object' ? item.detail.uriTemplate : undefined);
    return vars.map(function mapVar(name) {
      return { name: `--${name}`, text: 'Input parameter', type: 'string', required: true };
    });
  }
  return inputflags(item);
}

/**
 * Get the command surface and target name for an item.
 * @param {Record<string, unknown>} item
 * @returns {{ surface: string, target: string }}
 */
function itemcommand(item) {
  if (item.type === 'resource') {
    const uri = item.detail && typeof item.detail === 'object' && typeof item.detail.uri === 'string'
      ? item.detail.uri
      : item.name;
    return { surface: 'resources', target: uri };
  }
  if (item.type === 'resource-template') {
    return { surface: 'templates', target: item.name };
  }
  if (item.type === 'prompt') {
    return { surface: 'prompts', target: item.name };
  }
  return { surface: 'tools', target: item.name };
}

/**
 * Build example lines for an item.
 * @param {Record<string, unknown>} item - Schema item for help output.
 * @param {string | undefined} serverName - Optional server name.
 * @param {Array<{ name: string, text: string, type: string, required: boolean }>} flags - Flag descriptors.
 * @param {string} cliName - CLI name for output.
 * @returns {string}
 */
function itemexample(item, serverName, flags, cliName) {
  const info = itemcommand(item);
  return exampleline(`${info.surface}`, info.target, flags, serverName, cliName);
}

/**
 * Build help entries for tools.
 * @param {Array<Record<string, unknown>>} items - Schema items to render.
 * @param {string | undefined} serverName - Optional server name.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {{ accent: string, subtle: string }} theme - Color theme configuration.
 * @param {string} cliName - CLI name for output.
 * @param {boolean} tty - Whether stdout is a TTY.
 * @returns {Array<{ name: string, description: string }>}
 */
export function toolhelp(items, serverName, colors, theme, cliName, tty) {
  const color = palette(colors, theme);
  const list = [];
  for (const item of items) {
    if (item.type !== 'tool') {
      continue;
    }
    const flags = itemflags(item);
    const example = itemexample(item, serverName, flags, cliName);
    const flagtext = formatflags(flags, color);
    const desc = entrydesc(item.description, flagtext, example, colors, tty);
    list.push({ name: `tools ${item.name}`, description: desc });
  }
  return list;
}

/**
 * Build help entries for prompts.
 * @param {Array<Record<string, unknown>>} items - Schema items to render.
 * @param {string | undefined} serverName - Optional server name.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {{ accent: string, subtle: string }} theme - Color theme configuration.
 * @param {string} cliName - CLI name for output.
 * @param {boolean} tty - Whether stdout is a TTY.
 * @returns {Array<{ name: string, description: string }>}
 */
export function prompthelp(items, serverName, colors, theme, cliName, tty) {
  const color = palette(colors, theme);
  const list = [];
  for (const item of items) {
    if (item.type !== 'prompt') {
      continue;
    }
    const flags = itemflags(item);
    const example = itemexample(item, serverName, flags, cliName);
    const flagtext = formatflags(flags, color);
    const desc = entrydesc(item.description, flagtext, example, colors, tty);
    list.push({ name: `prompts ${item.name}`, description: desc });
  }
  return list;
}

/**
 * Build help entries for resources.
 * @param {Array<Record<string, unknown>>} items - Schema items to render.
 * @param {string | undefined} serverName - Optional server name.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {{ accent: string, subtle: string }} theme - Color theme configuration.
 * @param {string} cliName - CLI name for output.
 * @param {boolean} tty - Whether stdout is a TTY.
 * @returns {Array<{ name: string, description: string }>}
 */
export function resourcehelp(items, serverName, colors, theme, cliName, tty) {
  const list = [];
  for (const item of items) {
    if (item.type !== 'resource') {
      continue;
    }
    const info = itemcommand(item);
    const example = itemexample(item, serverName, [], cliName);
    const desc = entrydesc(item.description, '', example, colors, tty);
    list.push({ name: `resources ${info.target}`, description: desc });
  }
  return list;
}

/**
 * Build help entries for resource templates.
 * @param {Array<Record<string, unknown>>} items - Schema items to render.
 * @param {string | undefined} serverName - Optional server name.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {{ accent: string, subtle: string }} theme - Color theme configuration.
 * @param {string} cliName - CLI name for output.
 * @param {boolean} tty - Whether stdout is a TTY.
 * @returns {Array<{ name: string, description: string }>}
 */
export function templatehelp(items, serverName, colors, theme, cliName, tty) {
  const color = palette(colors, theme);
  const list = [];
  for (const item of items) {
    if (item.type !== 'resource-template') {
      continue;
    }
    const flags = itemflags(item);
    const example = itemexample(item, serverName, flags, cliName);
    const flagtext = formatflags(flags, color);
    const desc = entrydesc(item.description, flagtext, example, colors, tty);
    list.push({ name: `templates ${item.name}`, description: desc });
  }
  return list;
}

/**
 * Build a help description block for a list entry.
 * @param {string | undefined} description - Description text to format.
 * @param {string} flags - Flag text block.
 * @param {string} example - Example command line.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {boolean} tty - Whether stdout is a TTY.
 * @returns {string}
 */
function entrydesc(description, flags, example, colors, tty) {
  const parts = [];
  const desc = renderdesc(description, colors, tty);
  if (desc) {
    parts.push(desc);
  }
  if (flags) {
    parts.push(flags);
  }
  parts.push(example);
  return `\n${parts.join('\n')}`;
}

/**
 * Format help flags as a readable multi-line block.
 * @param {Array<{ name: string, text: string, type: string, required: boolean }>} flags - Flag descriptors.
 * @param {{ flag: (text: string) => string }} color - Color helper.
 * @returns {string}
 */
function formatflags(flags, color) {
  if (flags.length === 0) {
    return '';
  }
  const lines = ['Flags:'];
  for (const flag of flags) {
    const req = flag.required ? ' (required)' : '';
    lines.push(`  ${color.flag(`${flag.name} (${flag.type})${req}`)}`);
    lines.push(...wrap(flag.text, 72, '    '));
  }
  return lines.join('\n');
}

/**
 * Build a help section for a specific item.
 * @param {Record<string, unknown>} item - Schema item for help output.
 * @param {string | undefined} serverName - Optional server name.
 * @param {{ name: string, version: string, description: string }} meta - CLI metadata.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {{ accent: string, subtle: string }} theme - Color theme configuration.
 * @param {string} cliName - CLI name for output.
 * @param {boolean} tty - Whether stdout is a TTY.
 * @returns {string}
 */
export function itemhelp(item, serverName, meta, colors, theme, cliName, tty) {
  const flags = itemflags(item);
  const info = itemcommand(item);
  const title = typeof item.title === 'string' ? item.title : item.name;
  const desc = typeof item.description === 'string'
    ? item.description
    : `Execute ${item.name}.`;
  const examples = [
    exampleline(info.surface, info.target, flags, serverName, cliName)
  ];
  const parts = [];
  parts.push(header(meta, theme, colors));
  parts.push('');
  parts.push(section('Description', desclines(title, desc, colors, tty), theme, colors));
  parts.push('');
  parts.push(section('Usage', [`${cliName} ${info.surface} ${info.target} [options]`], theme, colors));
  if (flags.length > 0) {
    parts.push('');
    parts.push(section('Flags', formatflags(flags, palette(colors, theme)).split('\n').slice(1), theme, colors));
  }
  const syntax = inputsyntax(flags);
  if (syntax.length > 0) {
    parts.push('');
    parts.push(section('Input syntax', syntax, theme, colors));
  }
  parts.push('');
  parts.push(section('Example', examples, theme, colors));
  return parts.join('\n');
}

/**
 * Build description lines for item help output.
 * @param {string} title - Item title.
 * @param {string} description - Item description.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {boolean} tty - Whether stdout is a TTY.
 * @returns {string[]}
 */
function desclines(title, description, colors, tty) {
  const rendered = renderdesc(description, colors, tty);
  if (!rendered) {
    return wrap(`${title}:`, 72, '  ');
  }
  if (!ismarkdown(description) || !usecolors(colors) || !tty) {
    return wrap(`${title}: ${rendered}`, 72, '  ');
  }
  const lines = String(rendered).split('\n');
  if (lines.length === 0) {
    return wrap(`${title}:`, 72, '  ');
  }
  lines[0] = `${title}: ${lines[0]}`;
  return lines.map(function indent(line) {
    return `  ${line}`;
  });
}

/**
 * Build help output for a custom command.
 * @param {{ name: string, description: string, details?: string, flags?: Record<string, string[]>, examples?: string[] }} command - Custom command metadata.
 * @param {{ name: string, version: string, description: string }} meta - CLI metadata.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {{ accent: string, subtle: string }} theme - Color theme configuration.
 * @param {string} cliName - CLI name for output.
 * @returns {string}
 */
export function commandhelp(command, meta, colors, theme, cliName) {
  const parts = [];
  parts.push(header(meta, theme, colors));
  parts.push('');
  const desc = command.details || command.description;
  parts.push(section('Description', wrap(`${command.name}: ${desc}`, 72, '  '), theme, colors));
  parts.push('');
  parts.push(section('Usage', [`${cliName} ${command.name} [options]`], theme, colors));
  if (command.flags && Object.keys(command.flags).length > 0) {
    parts.push('');
    parts.push(section('Flags', customflags(command.flags, colors, theme), theme, colors));
  }
  if (command.examples && command.examples.length > 0) {
    parts.push('');
    parts.push(section('Examples', listexamples(command.examples), theme, colors));
  }
  return parts.join('\n');
}

/**
 * Render custom command flags for help output.
 * @param {Record<string, string[]>} flags - Custom flag definitions.
 * @param {boolean} colors - Whether color output is enabled.
 * @param {{ accent: string, subtle: string }} theme - Color theme configuration.
 * @returns {string[]}
 */
function customflags(flags, colors, theme) {
  const color = palette(colors, theme);
  const lines = [];
  for (const [name, desc] of Object.entries(flags)) {
    const text = Array.isArray(desc) ? desc.join(' ') : String(desc);
    lines.push(`  ${color.flag(name)}  ${text}`);
  }
  return lines;
}

/**
 * Add a help section only when items exist.
 * @param {Array<{ title: string, list: Array<{ name: string, description: string }> }>} extras - Dynamic help sections.
 * @param {string} title - Section title.
 * @param {Array<{ name: string, description: string }>} items - Help items.
 * @returns {void}
 */
export function addsection(extras, title, items) {
  if (items.length === 0) {
    return;
  }
  extras.push({ title, list: items });
}

/**
 * Format command list.
 * @param {Array<{ name: string, description: string }>} cmds
 * @returns {string[]}
 */
function listcmds(cmds) {
  return cmds.map(function mapcmd(cmd) {
    return `  ${cmd.name}  ${cmd.description}`;
  });
}

/**
 * Format flags list.
 * @param {Record<string, string>} flags
 * @param {boolean} colors
 * @param {{ accent: string, subtle: string }} theme
 * @returns {string[]}
 */
function listflags(flags, colors, theme) {
  const color = palette(colors, theme);
  const lines = [];
  for (const [name, desc] of Object.entries(flags)) {
    lines.push(`  ${color.flag(name)}  ${desc}`);
  }
  return lines;
}

/**
 * Format examples list.
 * @param {string[]} examples
 * @returns {string[]}
 */
function listexamples(examples) {
  return examples.map(function mapex(example) {
    return `  ${example}`;
  });
}

/**
 * Format servers list.
 * @param {Array<{ name: string, description: string }>} servers
 * @returns {string[]}
 */
function listservers(servers) {
  return servers.map(function mapserver(server) {
    return `  ${server.name}  ${server.description}`;
  });
}
