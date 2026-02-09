import argh from 'argh';

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
 * Build global CLI options from parsed argv.
 * @param {Record<string, unknown>} parsed - Parsed flags from `argh` for the main argument list.
 * @returns {{ server?: string, config?: string, format?: string, json?: string, input?: string, transport?: string, help: boolean, version: boolean, colors: boolean, spinner: boolean, raw: boolean, markdown: boolean, ansi: boolean }}
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
  const colors = parsed.color === false ? false : true;
  const spinner = parsed.spinner === false ? false : true;
  const raw = Boolean(parsed.raw);
  const markdown = parsed.markdown === false ? false : true;
  const ansi = Boolean(parsed['allow-ansi']);
  return { server, config, format, json, input, transport, help, version, colors, spinner, raw, markdown, ansi };
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
    return { surface: parts[0], action: 'exec', target: parts[1] || null };
  }
  const second = positionals[1] || '';
  const third = positionals[2] || null;
  if (first === 'tools' || first === 'prompts' || first === 'resources' || first === 'templates') {
    if (!second || second === 'list') {
      return { surface: first, action: 'list', target: null };
    }
    return { surface: first, action: 'exec', target: second };
  }
  if (first === 'servers') {
    return { surface: 'servers', action: second || 'list', target: third };
  }
  return { surface: 'help', action: 'help', target: null };
}
