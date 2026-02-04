import path from 'node:path';
import { parseDocument, writeDocument } from '../schema.js';

/**
 * Neovim stores MCP config under ~/.config/nvim/mcp.json.
 * @returns {string[]}
 */
function project() {
  return [];
}

/**
 * @param {{ home?: string }} ctx - Environment context for path resolution.
 * @returns {string[]}
 */
function home(ctx) {
  if (!ctx.home) {
    return [];
  }
  return [path.join(ctx.home, '.config', 'nvim', 'mcp.json')];
}

export const neovim = {
  name: 'neovim',
  project,
  home,
  parse: parseDocument,
  write: writeDocument
};
