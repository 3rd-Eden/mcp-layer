import path from 'node:path';
import { parseDocument, writeDocument } from '../schema.js';

function project() {
  return [];
}

function home(ctx) {
  if (!ctx.home) {
    return [];
  }
  return [path.join(ctx.home, '.config', 'helix', 'mcp.json')];
}

export const helix = {
  name: 'helix',
  project,
  home,
  parse: parseDocument,
  write: writeDocument
};
