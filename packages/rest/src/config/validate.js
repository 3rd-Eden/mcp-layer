import { DEFAULTS } from './defaults.js';

/**
 * Test whether a value is a plain object.
 * @param {unknown} value - Value to test.
 * @returns {value is Record<string, unknown>}
 */
function isrecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Merge a shallow configuration object over defaults.
 * @param {Record<string, unknown>} base - Default config object.
 * @param {Record<string, unknown> | undefined} next - Override config object.
 * @returns {Record<string, unknown>}
 */
function merge(base, next) {
  if (!isrecord(next)) {
    return { ...base };
  }
  return { ...base, ...next };
}

/**
 * Assert that a value is a finite positive number.
 *
 * Why this exists: keeps safety limits predictable and prevents accidental
 * disabling of guards by passing invalid values.
 *
 * @param {string} name - Option name.
 * @param {unknown} value - Option value.
 * @returns {number}
 */
function requirePositiveNumber(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive number.`);
  }
  return value;
}

/**
 * Validate trustSchemas value.
 *
 * Why this exists: downstream validators assume a finite set of modes.
 *
 * @param {unknown} value - trustSchemas input.
 * @returns {'auto' | true | false}
 */
function trustMode(value) {
  if (value === 'auto' || value === true || value === false) {
    return value;
  }
  throw new TypeError('validation.trustSchemas must be "auto", true, or false.');
}

/**
 * Validate plugin options and apply defaults.
 *
 * Why this exists: ensures required options are present and that downstream
 * modules receive consistent configuration shapes.
 *
 * @param {Record<string, unknown>} opts - User-supplied options.
 * @returns {{ session: unknown, prefix?: string | ((version: string, info: Record<string, unknown> | undefined, name: string) => string), validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled: boolean, serviceName: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, exposeOpenAPI: boolean }}
 */
export function validateOptions(opts) {
  const input = isrecord(opts) ? opts : {};
  const session = input.session;

  if (!session) {
    throw new Error('session option is required.');
  }

  if (input.prefix !== undefined && typeof input.prefix !== 'string' && typeof input.prefix !== 'function') {
    throw new TypeError('prefix must be a string or function.');
  }
  if (input.errors !== undefined && !isrecord(input.errors)) {
    throw new TypeError('errors must be an object.');
  }
  if (input.validation !== undefined && !isrecord(input.validation)) {
    throw new TypeError('validation must be an object.');
  }

  const validation = merge(DEFAULTS.validation, input.validation);
  const resilience = merge(DEFAULTS.resilience, input.resilience);
  const telemetry = merge(DEFAULTS.telemetry, input.telemetry);
  const errors = merge(DEFAULTS.errors, input.errors);
  const normalizedValidation = /** @type {typeof DEFAULTS.validation} */ (validation);

  normalizedValidation.trustSchemas = trustMode(normalizedValidation.trustSchemas);
  normalizedValidation.maxSchemaDepth = requirePositiveNumber('validation.maxSchemaDepth', normalizedValidation.maxSchemaDepth);
  normalizedValidation.maxSchemaSize = requirePositiveNumber('validation.maxSchemaSize', normalizedValidation.maxSchemaSize);
  normalizedValidation.maxPatternLength = requirePositiveNumber('validation.maxPatternLength', normalizedValidation.maxPatternLength);
  normalizedValidation.maxToolNameLength = requirePositiveNumber('validation.maxToolNameLength', normalizedValidation.maxToolNameLength);
  normalizedValidation.maxTemplateParamLength = requirePositiveNumber('validation.maxTemplateParamLength', normalizedValidation.maxTemplateParamLength);

  return {
    session,
    prefix: input.prefix,
    validation: normalizedValidation,
    resilience: /** @type {typeof DEFAULTS.resilience} */ (resilience),
    telemetry: /** @type {typeof DEFAULTS.telemetry} */ (telemetry),
    errors: /** @type {typeof DEFAULTS.errors} */ (errors),
    exposeOpenAPI: input.exposeOpenAPI === undefined ? DEFAULTS.exposeOpenAPI : Boolean(input.exposeOpenAPI)
  };
}
