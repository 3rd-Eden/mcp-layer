import path from 'node:path';
import { parseDocument, writeDocument } from '../schema.js';

/**
 * Claude Desktop stores all configuration at the user level.
 * @returns {string[]}
 */
function project() {
  return [];
}

/**
 * Discover Claude Desktop configuration files per platform.
 * @param {{ home?: string, platform: NodeJS.Platform }} ctx
 * @returns {string[]}
 */
function home(ctx) {
  const base = ctx.home;
  if (!base) {
    return [];
  }
  const list = [path.join(base, '.claude', 'settings.json')];
  if (ctx.platform === 'darwin') {
    list.push(path.join(base, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'));
  } else if (ctx.platform === 'win32') {
    list.push(path.join(base, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'));
  }
  return list;
}

export const claudeDesktop = {
  name: 'claude-desktop',
  project,
  home,
  parse: parseDocument,
  write: writeDocument
};
