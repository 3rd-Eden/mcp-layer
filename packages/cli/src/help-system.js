import { palette } from './colors.js';
import { header, section, wrap } from './help-render.js';

/**
 * Build help text for the CLI.
 * @param {{ name: string, version: string, description: string }} meta
 * @param {Array<{ name: string, description: string }>} cmds
 * @param {Record<string, string>} flags
 * @param {string[]} examples
 * @param {Array<{ name: string, description: string }>} servers
 * @param {Array<{ title: string, list: Array<{ name: string, description: string }> }>} extras
 * @param {boolean} preferExtras
 * @param {boolean} colors
 * @param {{ accent: string, subtle: string }} theme
 * @returns {string}
 */
export function mainhelp(meta, cmds, flags, examples, servers, extras, preferExtras, colors, theme) {
  const out = [];
  out.push(header(meta, theme, colors));
  out.push('');
  if (preferExtras && extras.length > 0) {
    out.push(formatextras(extras, colors, theme));
    out.push('');
  }
  out.push(section('Usage', ['mcp-layer <command> [options]'], theme, colors));
  out.push('');
  out.push(section('Commands', listcmds(cmds), theme, colors));
  out.push('');
  out.push(section('Options', listflags(flags, colors, theme), theme, colors));
  out.push('');
  out.push(section('Examples', listexamples(examples), theme, colors));
  out.push('');
  out.push(section('Servers', listservers(servers), theme, colors));
  return out.join('\n');
}

/**
 * Render dynamic help sections without truncation.
 * @param {Array<{ title: string, list: Array<{ name: string, description: string }> }>} extras
 * @param {boolean} colors
 * @param {{ accent: string, subtle: string }} theme
 * @returns {string}
 */
function formatextras(extras, colors, theme) {
  const color = palette(colors, theme);
  const blocks = [];
  for (const section of extras) {
    const lines = [];
    lines.push(color.title(`${section.title}:`));
    for (const item of section.list) {
      lines.push(`  ${color.name(item.name)}`);
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
function exampleline(verb, name, flags, serverName) {
  const samples = flags.slice(0, 2).map(function mapFlag(flag) {
    return `${flag.name} ${valuehint(flag)}`;
  });
  const server = serverName ? ` --server ${serverName}` : '';
  const args = samples.length ? ` ${samples.join(' ')}` : '';
  return `Example: mcp-layer ${verb} ${name}${server}${args}`;
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
 * @param {Record<string, unknown>} item
 * @param {string | undefined} serverName
 * @param {Array<{ name: string, text: string, type: string, required: boolean }>} flags
 * @returns {string}
 */
function itemexample(item, serverName, flags) {
  const info = itemcommand(item);
  return exampleline(`${info.surface}`, info.target, flags, serverName);
}

/**
 * Build help entries for tools.
 * @param {Array<Record<string, unknown>>} items
 * @param {string | undefined} serverName
 * @param {boolean} colors
 * @param {{ accent: string, subtle: string }} theme
 * @returns {Array<{ name: string, description: string }>}
 */
export function toolhelp(items, serverName, colors, theme) {
  const color = palette(colors, theme);
  const list = [];
  for (const item of items) {
    if (item.type !== 'tool') {
      continue;
    }
    const flags = itemflags(item);
    const example = itemexample(item, serverName, flags);
    const flagtext = formatflags(flags, color);
    const desc = entrydesc(item.description, flagtext, example);
    list.push({ name: `tools ${item.name}`, description: desc });
  }
  return list;
}

/**
 * Build help entries for prompts.
 * @param {Array<Record<string, unknown>>} items
 * @param {string | undefined} serverName
 * @param {boolean} colors
 * @param {{ accent: string, subtle: string }} theme
 * @returns {Array<{ name: string, description: string }>}
 */
export function prompthelp(items, serverName, colors, theme) {
  const color = palette(colors, theme);
  const list = [];
  for (const item of items) {
    if (item.type !== 'prompt') {
      continue;
    }
    const flags = itemflags(item);
    const example = itemexample(item, serverName, flags);
    const flagtext = formatflags(flags, color);
    const desc = entrydesc(item.description, flagtext, example);
    list.push({ name: `prompts ${item.name}`, description: desc });
  }
  return list;
}

/**
 * Build help entries for resources.
 * @param {Array<Record<string, unknown>>} items
 * @param {string | undefined} serverName
 * @param {boolean} colors
 * @param {{ accent: string, subtle: string }} theme
 * @returns {Array<{ name: string, description: string }>}
 */
export function resourcehelp(items, serverName, colors, theme) {
  const list = [];
  for (const item of items) {
    if (item.type !== 'resource') {
      continue;
    }
    const info = itemcommand(item);
    const example = itemexample(item, serverName, []);
    const desc = entrydesc(item.description, 'Flags:\n  (none)', example);
    list.push({ name: `resources ${info.target}`, description: desc });
  }
  return list;
}

/**
 * Build help entries for resource templates.
 * @param {Array<Record<string, unknown>>} items
 * @param {string | undefined} serverName
 * @param {boolean} colors
 * @param {{ accent: string, subtle: string }} theme
 * @returns {Array<{ name: string, description: string }>}
 */
export function templatehelp(items, serverName, colors, theme) {
  const color = palette(colors, theme);
  const list = [];
  for (const item of items) {
    if (item.type !== 'resource-template') {
      continue;
    }
    const flags = itemflags(item);
    const example = itemexample(item, serverName, flags);
    const flagtext = formatflags(flags, color);
    const desc = entrydesc(item.description, flagtext, example);
    list.push({ name: `templates ${item.name}`, description: desc });
  }
  return list;
}

/**
 * Build a help description block for a list entry.
 * @param {string | undefined} description
 * @param {string} flags
 * @param {string} example
 * @returns {string}
 */
function entrydesc(description, flags, example) {
  const parts = [];
  if (description) {
    parts.push(description);
  }
  parts.push(flags);
  parts.push(example);
  return `\n${parts.join('\n')}`;
}

/**
 * Format help flags as a readable multi-line block.
 * @param {Array<{ name: string, text: string, type: string, required: boolean }>} flags
 * @param {{ flag: (text: string) => string }} color
 * @returns {string}
 */
function formatflags(flags, color) {
  if (flags.length === 0) {
    return 'Flags:\n  (none)';
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
 * @param {Record<string, unknown>} item
 * @param {string | undefined} serverName
 * @param {{ name: string, version: string, description: string }} meta
 * @param {boolean} colors
 * @param {{ accent: string, subtle: string }} theme
 * @returns {string}
 */
export function itemhelp(item, serverName, meta, colors, theme) {
  const flags = itemflags(item);
  const info = itemcommand(item);
  const title = typeof item.title === 'string' ? item.title : item.name;
  const desc = typeof item.description === 'string'
    ? item.description
    : `Execute ${item.name}.`;
  const examples = [
    exampleline(info.surface, info.target, flags, serverName)
  ];
  const parts = [];
  parts.push(header(meta, theme, colors));
  parts.push('');
  parts.push(section('Description', wrap(`${title}: ${desc}`, 72, '  '), theme, colors));
  parts.push('');
  parts.push(section('Usage', [`mcp-layer ${info.surface} ${info.target} [options]`], theme, colors));
  parts.push('');
  parts.push(section('Flags', formatflags(flags, palette(colors, theme)).split('\n').slice(1), theme, colors));
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
 * Add a help section only when items exist.
 * @param {Array<{ title: string, list: Array<{ name: string, description: string }> }>} extras
 * @param {string} title
 * @param {Array<{ name: string, description: string }>} items
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
