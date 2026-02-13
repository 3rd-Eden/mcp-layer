import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

/**
 * Build a user-scoped Windows named pipe identifier.
 * @returns {string}
 */
function pipe() {
  const seed = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
  const id = createHash('sha1').update(String(seed)).digest('hex').slice(0, 12);
  return `\\\\.\\pipe\\mcp-layer-stateful-${id}`;
}

/**
 * Resolve the stateful sessions root directory.
 * @returns {string}
 */
export function root() {
  return path.join(os.homedir(), '.mcp-layer', 'sessions');
}

/**
 * Resolve the service metadata path.
 * @returns {string}
 */
export function serviceFile() {
  return path.join(root(), 'service.json');
}

/**
 * Resolve the sessions metadata path.
 * @returns {string}
 */
export function sessionsFile() {
  return path.join(root(), 'sessions.json');
}

/**
 * Resolve the stateful events log path.
 * @returns {string}
 */
export function eventsFile() {
  return path.join(root(), 'events.log');
}

/**
 * Resolve the IPC endpoint for the current platform.
 * @returns {string}
 */
export function endpoint() {
  if (process.platform === 'win32') return pipe();
  return path.join(root(), 'stateful.sock');
}
