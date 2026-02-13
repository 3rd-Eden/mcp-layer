import { appendFile, chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { LayerError } from '@mcp-layer/error';
import { endpoint, eventsFile, root, serviceFile, sessionsFile } from './path.js';

const REDACT = /(token|secret|password|authorization|api[_-]?key)/i;
const DEFAULT_EVENT_MAX_BYTES = 1024 * 1024;
const DEFAULT_EVENT_MAX_FILES = 3;
const VALUE_REDACT = [
  /bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*[A-Za-z0-9\-._~+/=]{8,}/i,
  /\b(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,})\b/
];

/**
 * Determine whether a string payload should be redacted.
 * @param {string} value - Candidate text value.
 * @returns {boolean}
 */
function isSensitive(value) {
  for (const pattern of VALUE_REDACT) {
    if (pattern.test(value)) return true;
  }

  return false;
}

/**
 * Ensure the stateful sessions directory exists.
 * @returns {Promise<void>}
 */
export async function ensureRoot() {
  const dir = root();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    await chmod(dir, 0o700);
  } catch {
    // Best effort permissions tightening.
  }
}

/**
 * Safely read a JSON file.
 * @param {string} file - JSON file path.
 * @param {Record<string, unknown>} fallback - Fallback value.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function readJson(file, fallback) {
  try {
    const raw = await readFile(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Write JSON atomically.
 * @param {string} file - JSON file path.
 * @param {Record<string, unknown>} data - JSON payload.
 * @returns {Promise<void>}
 */
export async function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  const body = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(tmp, body, 'utf8');
  await rename(tmp, file);

  if (process.platform === 'win32') return;

  try {
    await chmod(file, 0o600);
  } catch {
    // Best effort permissions tightening.
  }
}

/**
 * Load persisted service metadata.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadServiceMeta() {
  await ensureRoot();
  return readJson(serviceFile(), {});
}

/**
 * Persist service metadata.
 * @param {Record<string, unknown>} data - Service metadata.
 * @returns {Promise<void>}
 */
export async function saveServiceMeta(data) {
  await ensureRoot();
  await writeJson(serviceFile(), data);
}

/**
 * Remove service metadata and stale endpoint files.
 * @returns {Promise<void>}
 */
export async function clearServiceMeta() {
  await ensureRoot();
  await rm(serviceFile(), { force: true });

  if (process.platform !== 'win32') {
    await rm(endpoint(), { force: true });
  }
}

/**
 * Load persisted session metadata list.
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function loadSessionsMeta() {
  await ensureRoot();
  const data = await readJson(sessionsFile(), { sessions: [] });
  return Array.isArray(data.sessions) ? data.sessions : [];
}

/**
 * Persist session metadata list.
 * @param {Array<Record<string, unknown>>} sessions - Session metadata.
 * @returns {Promise<void>}
 */
export async function saveSessionsMeta(sessions) {
  await ensureRoot();
  await writeJson(sessionsFile(), { sessions });
}

/**
 * Redact sensitive values in audit payloads.
 * @param {unknown} value - Payload value.
 * @returns {unknown}
 */
function redact(value) {
  if (typeof value === 'string') {
    if (isSensitive(value)) return '[REDACTED]';
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(function mapValue(item) {
      return redact(item);
    });
  }

  if (value && typeof value === 'object') {
    const next = {};

    for (const [key, item] of Object.entries(value)) {
      if (REDACT.test(key)) {
        next[key] = '[REDACTED]';
        continue;
      }

      next[key] = redact(item);
    }

    return next;
  }

  return value;
}

/**
 * Resolve a numeric event log option with sane defaults.
 * @param {unknown} value - Candidate option value.
 * @param {number} fallback - Default value.
 * @returns {number}
 */
function option(value, fallback) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  if (value < 0) return fallback;
  return Math.floor(value);
}

/**
 * Rotate event log files by one generation.
 * @param {string} file - Primary events log path.
 * @param {number} maxFiles - Maximum number of backup files.
 * @returns {Promise<void>}
 */
async function rotate(file, maxFiles) {
  if (maxFiles <= 0) {
    await rm(file, { force: true });
    return;
  }

  let idx = maxFiles;
  while (idx >= 1) {
    const from = idx === 1 ? file : `${file}.${idx - 1}`;
    const to = `${file}.${idx}`;
    await rm(to, { force: true });

    try {
      await rename(from, to);
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && String(error.code ?? '') === 'ENOENT') {
        idx -= 1;
        continue;
      }

      throw error;
    }

    if (process.platform !== 'win32') {
      try {
        await chmod(to, 0o600);
      } catch {
        // Best effort permissions tightening.
      }
    }

    idx -= 1;
  }
}

/**
 * Append a lifecycle event to the events log.
 * @param {{ type: string, data?: Record<string, unknown> }} entry - Event payload.
 * @param {{ maxBytes?: number, maxFiles?: number }} [input] - Rotation controls.
 * @returns {Promise<void>}
 */
export async function appendEvent(entry, input = {}) {
  await ensureRoot();
  const file = eventsFile();
  const maxBytes = option(input.maxBytes, DEFAULT_EVENT_MAX_BYTES);
  const maxFiles = option(input.maxFiles, DEFAULT_EVENT_MAX_FILES);

  const line = {
    at: new Date().toISOString(),
    type: entry.type,
    data: redact(entry.data ?? {})
  };
  const payload = `${JSON.stringify(line)}\n`;
  const size = Buffer.byteLength(payload, 'utf8');

  if (maxBytes > 0) {
    try {
      const info = await stat(file);
      if (info.size + size > maxBytes) {
        // Rotate before appending so the newest event is always in events.log.
        await rotate(file, maxFiles);
      }
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || String(error.code ?? '') !== 'ENOENT') {
        throw error;
      }
    }
  }

  await appendFile(file, payload, 'utf8');

  if (process.platform === 'win32') return;

  try {
    await chmod(file, 0o600);
  } catch {
    // Best effort permissions tightening.
  }
}

/**
 * Build a deterministic configuration hash.
 * @param {Record<string, unknown>} value - Config payload.
 * @returns {string}
 */
export function hash(value) {
  const json = JSON.stringify(value ?? {});
  let idx = 0;
  let out = 2166136261;

  for (; idx < json.length; idx += 1) {
    out ^= json.charCodeAt(idx);
    out = Math.imul(out, 16777619);
  }

  return Math.abs(out).toString(16);
}

/**
 * Normalize errors produced by service handlers.
 * @param {unknown} error - Error value.
 * @param {string} method - Method name.
 * @returns {LayerError}
 */
export function normalizeError(error, method) {
  if (error instanceof LayerError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new LayerError({
    name: 'stateful',
    method,
    message,
    code: 'SESSION_INTERNAL',
    cause: error
  });
}

/**
 * Resolve socket endpoint parent directory.
 * @returns {string}
 */
export function endpointDir() {
  return path.dirname(endpoint());
}
