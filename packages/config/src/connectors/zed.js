import path from 'node:path';
import { parseDocument, writeDocument } from '../schema.js';

function project() {
  return [];
}

function home(ctx) {
  if (!ctx.home) return [];
  return [path.join(ctx.home, '.config', 'zed', 'mcp.json')];
}

export const zed = {
  name: 'zed',
  project,
  home,
  parse: parseDocument,
  write: writeDocument
};
