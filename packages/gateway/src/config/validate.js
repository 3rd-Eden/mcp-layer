import { defaults } from './defaults.js';
import { LayerError } from '@mcp-layer/error';

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
  if (!isrecord(next)) return { ...base };
  return { ...base, ...next };
}

/**
 * Assert that a value is a finite positive number.
 * @param {string} name - Option name.
 * @param {unknown} value - Option value.
 * @param {string} pack - Package identifier for errors.
 * @returns {number}
 */
function requirePositiveNumber(name, value, pack) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new LayerError({
      name: pack,
      method: 'requirePositiveNumber',
      message: '"{option}" must be a positive number.',
      vars: { option: name }
    });
  }
  return value;
}

/**
 * Validate trustSchemas value.
 * @param {unknown} value - trustSchemas input.
 * @param {string} pack - Package identifier for errors.
 * @returns {'auto' | true | false}
 */
function trustMode(value, pack) {
  if (value === 'auto' || value === true || value === false) return value;
  throw new LayerError({
    name: pack,
    method: 'trustMode',
    message: 'validation.trustSchemas must be "auto", true, or false.',
  });
}

/**
 * Validate base runtime options and apply defaults.
 * @param {Record<string, unknown>} opts - User-supplied options.
 * @param {{ name?: string, serviceName?: string }} [meta] - Validation metadata.
 * @returns {{ session: unknown, manager?: { get: (request: import('fastify').FastifyRequest) => Promise<import('@mcp-layer/session').Session>, close?: () => Promise<void> }, prefix?: string | ((version: string, info: Record<string, unknown> | undefined, name: string) => string), validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled: boolean, serviceName: string, metricPrefix: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, normalizeError?: (error: Error & { code?: string | number }, instance: string, requestId?: string, options?: { exposeDetails?: boolean }) => unknown }}
 */
export function validateRuntimeOptions(opts, meta = {}) {
  const pack = typeof meta.name === 'string' && meta.name.length > 0 ? meta.name : 'gateway';
  const serviceName = typeof meta.serviceName === 'string' && meta.serviceName.length > 0
    ? meta.serviceName
    : 'mcp-layer-gateway';
  const base = defaults(serviceName);
  const input = isrecord(opts) ? opts : {};
  const session = input.session;
  const manager = input.manager;

  if (!session && !manager) {
    throw new LayerError({
      name: pack,
      method: 'validateRuntimeOptions',
      message: 'session or manager option is required.',
    });
  }

  if (manager !== undefined) {
    if (!isrecord(manager) || typeof manager.get !== 'function') {
      throw new LayerError({
        name: pack,
        method: 'validateRuntimeOptions',
        message: 'manager must be an object with a get(request) function.',
      });
    }
    if (!session) {
      throw new LayerError({
        name: pack,
        method: 'validateRuntimeOptions',
        message: 'session is required when manager is provided (used for catalog bootstrap).',
      });
    }
    if (Array.isArray(session)) {
      throw new LayerError({
        name: pack,
        method: 'validateRuntimeOptions',
        message: 'manager does not support multiple sessions. Register multiple plugins instead.',
      });
    }
  }

  if (input.prefix !== undefined && typeof input.prefix !== 'string' && typeof input.prefix !== 'function') {
    throw new LayerError({
      name: pack,
      method: 'validateRuntimeOptions',
      message: 'prefix must be a string or function.',
    });
  }

  if (input.errors !== undefined && !isrecord(input.errors)) {
    throw new LayerError({
      name: pack,
      method: 'validateRuntimeOptions',
      message: 'errors must be an object.',
    });
  }

  if (input.validation !== undefined && !isrecord(input.validation)) {
    throw new LayerError({
      name: pack,
      method: 'validateRuntimeOptions',
      message: 'validation must be an object.',
    });
  }

  if (input.normalizeError !== undefined && typeof input.normalizeError !== 'function') {
    throw new LayerError({
      name: pack,
      method: 'validateRuntimeOptions',
      message: 'normalizeError must be a function.',
    });
  }

  const validation = merge(base.validation, input.validation);
  const resilience = merge(base.resilience, input.resilience);
  const telemetry = merge(base.telemetry, input.telemetry);
  const errors = merge(base.errors, input.errors);
  const normalizedValidation = /** @type {typeof base.validation} */ (validation);

  normalizedValidation.trustSchemas = trustMode(normalizedValidation.trustSchemas, pack);
  normalizedValidation.maxSchemaDepth = requirePositiveNumber('validation.maxSchemaDepth', normalizedValidation.maxSchemaDepth, pack);
  normalizedValidation.maxSchemaSize = requirePositiveNumber('validation.maxSchemaSize', normalizedValidation.maxSchemaSize, pack);
  normalizedValidation.maxPatternLength = requirePositiveNumber('validation.maxPatternLength', normalizedValidation.maxPatternLength, pack);
  normalizedValidation.maxToolNameLength = requirePositiveNumber('validation.maxToolNameLength', normalizedValidation.maxToolNameLength, pack);
  normalizedValidation.maxTemplateParamLength = requirePositiveNumber('validation.maxTemplateParamLength', normalizedValidation.maxTemplateParamLength, pack);

  if (typeof telemetry.metricPrefix !== 'string' || telemetry.metricPrefix.length === 0) {
    telemetry.metricPrefix = base.telemetry.metricPrefix;
  }

  return {
    session,
    manager: /** @type {{ get: (request: import('fastify').FastifyRequest) => Promise<import('@mcp-layer/session').Session>, close?: () => Promise<void> } | undefined} */ (manager),
    prefix: input.prefix,
    validation: normalizedValidation,
    resilience: /** @type {typeof base.resilience} */ (resilience),
    telemetry: /** @type {typeof base.telemetry} */ (telemetry),
    errors: /** @type {typeof base.errors} */ (errors),
    normalizeError: /** @type {((error: Error & { code?: string | number }, instance: string, requestId?: string, options?: { exposeDetails?: boolean }) => unknown) | undefined} */ (input.normalizeError)
  };
}
