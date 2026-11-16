import { LayerError } from '@mcp-layer/error';
import { ImplementationSchema } from '@modelcontextprotocol/sdk/types.js';
import { allowlist, clean, implementation } from './clean.js';

/**
 * Validate public client identity.
 * @param {unknown} value - Identity input.
 * @returns {boolean} Whether standard SDK metadata and optional platform are valid.
 */
export function identity(value) {
  return Boolean(value && ImplementationSchema.safeParse(value).success && typeof value.name === 'string' && value.name.trim()
    && typeof value.version === 'string' && value.version.trim() && (value.platform === undefined || typeof value.platform === 'string'));
}

/**
 * Start an in-memory recorder that exposes sanitized snapshots only.
 * @param {import('./types.js').CaptureOptions} [options={}] - Capture identity, timestamp, and public header allowlist.
 * @returns {import('./types.js').Recorder} Recorder with observe and idempotent finish methods.
 * @throws {LayerError} When options are invalid or observation follows finish.
 */
export function capture(options = {}) {
  if (!options || typeof options !== 'object' || (options.client !== undefined && !identity(options.client))
    || (options.id !== undefined && (typeof options.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(options.id)))
    || (options.capturedAt !== undefined && (typeof options.capturedAt !== 'string' || !Number.isFinite(Date.parse(options.capturedAt))))) {
    throw new LayerError({ name: 'profiles', method: 'capture', message: 'Capture options must contain valid public identity metadata and header names.', code: 'ERR_PROFILES_OPTIONS' });
  }
  /** @type {import('./types.js').Capture} */
  const result = { schema: 1, capturedAt: new Date(options.capturedAt ?? Date.now()).toISOString(), allowHeaders: allowlist(options.allowHeaders), observations: [] };
  if (options.id !== undefined) result.id = options.id;
  if (options.client) {
    result.client = implementation(options.client);
    if (options.client.platform !== undefined) result.client.platform = options.client.platform;
  }
  let finished = false;
  /**
   * Append one sanitized observation.
   * @param {import('./types.js').Observation} observation - Incoming evidence.
   * @returns {import('./types.js').Evidence} Independent sanitized observation.
   * @throws {LayerError} When recording has finished or metadata is invalid.
   */
  function observe(observation) {
    if (finished) {
      throw new LayerError({ name: 'profiles', method: 'capture.observe', message: 'A finished capture cannot accept more observations.', code: 'ERR_PROFILES_FINISHED' });
    }
    const evidence = clean(observation, result.allowHeaders);
    result.observations.push(evidence);
    return structuredClone(evidence);
  }
  /**
   * Close recording and return an independent sanitized capture.
   * @returns {import('./types.js').Capture} Complete capture snapshot.
   */
  function finish() {
    finished = true;
    return structuredClone(result);
  }
  return { observe, finish };
}
