import path from 'node:path';
import { parseDocument, writeDocument } from '../schema.js';

/**
 * Resolve project-scoped configuration files for Cursor.
 * @param {string} dir
 * @returns {string[]}
 */
function project(dir) {
  return [
    path.join(dir, '.cursor', 'mcp.json')
  ];
}

/**
 * Resolve user-level configuration files for Cursor.
 * @param {{ home?: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform }} ctx
 * @returns {string[]}
 */
function home(ctx) {
  const list = [];
  const base = ctx.home;
  if (!base) {
    return list;
  }

  list.push(path.join(base, '.cursor', 'mcp.json'));

  return list;
}

export const cursor = {
  name: 'cursor',
  project,
  home,
  parse: parseDocument,
  write: writeDocument
};
