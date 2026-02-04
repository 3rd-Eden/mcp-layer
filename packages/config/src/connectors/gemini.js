import path from 'node:path';
import { parseDocument, writeDocument } from '../schema.js';

/**
 * Locate project-scoped Gemini CLI configuration files.
 * @param {string} dir - Project root directory to search.
 * @returns {string[]}
 */
function project(dir) {
  return [path.join(dir, '.gemini', 'settings.json')];
}

/**
 * Discover user-level Gemini CLI configuration files.
 * @param {{ home?: string }} ctx - Environment context for path resolution.
 * @returns {string[]}
 */
function home(ctx) {
  if (!ctx.home) {
    return [];
  }
  return [path.join(ctx.home, '.gemini', 'settings.json')];
}

export const gemini = {
  name: 'gemini-cli',
  project,
  home,
  parse: parseDocument,
  write: writeDocument
};
