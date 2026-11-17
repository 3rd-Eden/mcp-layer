import { readFile, writeFile } from 'node:fs/promises';
import { get, validate } from './profile.js';
import { LayerError } from '@mcp-layer/error';

/**
 * Read a JSON artifact without interpreting it as executable configuration.
 * @param {string} file Capture or profile JSON path.
 * @returns {Promise<unknown>} Parsed JSON artifact.
 * @throws {LayerError} When the artifact cannot be read or parsed.
 */
export async function read(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (cause) {
    throw new LayerError({ name: 'profiles', method: 'read', code: 'ERR_PROFILES_ARTIFACT', message: 'Could not read JSON artifact "{file}".', vars: { file }, cause });
  }
}

/**
 * Serialize public artifacts in a reproducible object-key order.
 * @param {unknown} value JSON-compatible artifact.
 * @returns {string} Indented canonical JSON followed by a newline.
 */
export function json(value) {
  /**
   * Order object fields without changing array or scalar values.
   * @param {string} key Current JSON property name.
   * @param {any} current Current JSON value.
   * @returns {any} Value with deterministic object keys.
   */
  function fields(key, current) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return current;
    const result = {};
    for (const name of Object.keys(current).sort()) result[name] = current[name];
    return result;
  }
  return `${JSON.stringify(value, fields, 2)}\n`;
}

/**
 * Write a sanitized capture or validated profile artifact.
 * @param {string} file Output JSON path.
 * @param {unknown} value Public artifact to serialize.
 * @returns {Promise<void>} Completion after the artifact is written.
 * @throws {LayerError} When the output file cannot be written.
 */
export async function write(file, value) {
  try {
    await writeFile(file, json(value), 'utf8');
  } catch (cause) {
    throw new LayerError({ name: 'profiles', method: 'write', code: 'ERR_PROFILES_ARTIFACT', message: 'Could not write JSON artifact "{file}".', vars: { file }, cause });
  }
}

/**
 * Load a bundled profile ID, profile object, explicit JSON path, or no profile.
 * @param {string | import('./types.js').Profile | undefined} value Public profile selector.
 * @returns {Promise<import('./types.js').Profile | undefined>} Sanitized reconstructed profile, or absence.
 * @throws {LayerError} For unknown IDs, unreadable artifacts or invalid evidence.
 */
export async function load(value) {
  if (value === undefined) return undefined;
  const source = typeof value === 'string'
    ? (/[\\/]|\.json$/i.test(value) ? await read(value) : get(value))
    : value;
  return validate(source);
}
