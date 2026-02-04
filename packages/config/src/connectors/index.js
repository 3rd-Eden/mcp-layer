import path from 'node:path';
import { claudeCode } from './claude-code.js';
import { cursor } from './cursor.js';
import { codex } from './codex.js';
import { vscode } from './vscode.js';
import { cline } from './cline.js';
import { windsurf } from './windsurf.js';
import { claudeDesktop } from './claude-desktop.js';
import { gemini } from './gemini.js';
import { neovim } from './neovim.js';
import { helix } from './helix.js';
import { zed } from './zed.js';
import { generic } from './generic.js';

/**
 * Generate ancestry list from cwd to root for priority evaluation.
 * @param {string} dir - Starting directory for upward traversal.
 * @returns {string[]}
 */
function ascend(dir) {
  const list = [];
  let current = path.resolve(dir);
  while (!list.includes(current)) {
    list.push(current);
    const next = path.dirname(current);
    if (next === current) {
      break;
    }
    current = next;
  }
  return list;
}

export const CONNECTORS = [
  claudeCode,
  cursor,
  codex,
  vscode,
  cline,
  gemini,
  windsurf,
  claudeDesktop,
  neovim,
  helix,
  zed,
  generic
];

/**
 * Locate a connector definition by name.
 * @param {string} name - Connector name to locate.
 * @returns {{ name: string, project: (dir: string) => string[], home: (ctx: { home?: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform }) => string[], parse: (raw: string, file: string) => { servers: Array<{ name: string, config: Record<string, unknown> }>, metadata?: Record<string, unknown> }, write: (file: string, entry: { name: string, config: Record<string, unknown> } | null, metadata?: Record<string, unknown>) => Promise<void> } | undefined}
 */
export function findConnector(name) {
  return CONNECTORS.find(function lookup(connector) {
    return connector.name === name;
  });
}

/**
 * Resolve ordered candidate files across all connectors.
 * @param {{ cwd: string, home?: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform }} ctx - Environment context for discovery.
 * @returns {Array<{ path: string, parse: (raw: string, file: string) => { servers: Array<{ name: string, config: Record<string, unknown> }>, metadata?: Record<string, unknown> }, source: { connector: string, scope: 'project' | 'home' } }>}
 */
export function collectCandidates(ctx) {
  const list = [];
  const dirs = ascend(ctx.cwd);

  for (const dir of dirs) {
    for (const connector of CONNECTORS) {
      if (typeof connector.project === 'function') {
        const project = connector.project(dir);
        for (const file of project) {
          const absolute = path.isAbsolute(file) || path.win32.isAbsolute(file) ? file : path.resolve(file);
          list.push({
            path: absolute,
            parse: connector.parse,
            source: { connector: connector.name, scope: 'project' }
          });
        }
      }
    }
  }

  for (const connector of CONNECTORS) {
    if (typeof connector.home === 'function') {
      const home = connector.home({
        home: ctx.home,
        env: ctx.env,
        platform: ctx.platform
      });
      for (const file of home) {
        const absolute = path.isAbsolute(file) || path.win32.isAbsolute(file) ? file : path.resolve(file);
        list.push({
          path: absolute,
          parse: connector.parse,
          source: { connector: connector.name, scope: 'home' }
        });
      }
    }
  }

  return list;
}
