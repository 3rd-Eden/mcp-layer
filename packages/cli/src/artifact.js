import { readFile, writeFile } from 'node:fs/promises';
import { apply, get } from '@mcp-layer/profiles';
import { LayerError } from '@mcp-layer/error';

/**
 * Read a JSON artifact without interpreting it as executable configuration.
 * @param {string} file Capture or profile JSON path.
 * @returns {Promise<any>} Parsed JSON artifact.
 * @throws {LayerError} When the artifact cannot be read or parsed.
 */
export async function read(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (cause) {
    throw new LayerError({ name: 'cli', method: 'read', code: 'ERR_CLI_ARTIFACT', message: 'Could not read JSON artifact "{file}".', vars: { file }, cause });
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
    throw new LayerError({ name: 'cli', method: 'write', code: 'ERR_CLI_ARTIFACT', message: 'Could not write JSON artifact "{file}".', vars: { file }, cause });
  }
}

/**
 * Load a bundled profile ID or explicit JSON path and verify its evidence.
 * @param {string | import('@mcp-layer/profiles').Profile | undefined} value Public profile selector.
 * @returns {Promise<import('@mcp-layer/profiles').Profile | undefined>} Validated profile, or absence.
 * @throws {LayerError} For unknown IDs, unreadable artifacts or invalid evidence.
 */
export async function profile(value) {
  if (value === undefined) return undefined;
  let result = value;
  if (typeof value === 'string') result = /[\\/]|\.json$/i.test(value) ? await read(value) : get(value);
  apply(result);
  return result;
}
