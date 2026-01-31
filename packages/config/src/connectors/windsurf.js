import path from 'node:path';
import { parseDocument, writeDocument } from '../schema.js';

/**
 * Windsurf does not support project-scoped configuration files.
 * @returns {string[]}
 */
function project() {
  return [];
}

/**
 * Resolve user-level Windsurf configuration file.
 * @param {{ home?: string }} ctx
 * @returns {string[]}
 */
function home(ctx) {
  const base = ctx.home;
  if (!base) {
    return [];
  }
  return [path.join(base, '.codeium', 'windsurf', 'mcp_config.json')];
}

export const windsurf = {
  name: 'windsurf',
  project,
  home,
  parse: parseDocument,
  write: writeDocument
};
