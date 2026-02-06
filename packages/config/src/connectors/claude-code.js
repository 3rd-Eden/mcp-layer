import path from 'node:path';
import { parseDocument, writeDocument } from '../schema.js';

/**
 * Produce candidate project-level config files for Claude Code.
 * @param {string} dir - Project root directory to search.
 * @returns {string[]}
 */
function project(dir) {
  return [
    path.join(dir, '.mcp.json')
  ];
}

/**
 * Collect global config locations for Claude Code across supported platforms.
 * @param {{ home?: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform }} ctx - Environment context for path resolution.
 * @returns {string[]}
 */
function home(ctx) {
  const list = [];

  if (ctx.env.MCP_CONFIG_PATH) {
    const custom = ctx.env.MCP_CONFIG_PATH.startsWith('~') && ctx.home
      ? path.join(ctx.home, ctx.env.MCP_CONFIG_PATH.slice(1))
      : ctx.env.MCP_CONFIG_PATH;
    list.push(custom);
  }

  if (ctx.home) list.push(path.join(ctx.home, '.mcp.json'));

  if (ctx.platform === 'darwin') {
    list.push(path.join('/Library', 'Application Support', 'ClaudeCode', 'managed-mcp.json'));
  } else if (ctx.platform === 'win32') {
    list.push('C:/ProgramData/ClaudeCode/managed-mcp.json');
  } else {
    list.push(path.join('/etc', 'claude-code', 'managed-mcp.json'));
  }

  return list;
}

export const claudeCode = {
  name: 'claude-code',
  project,
  home,
  parse: parseDocument,
  write: writeDocument
};
