import { validateRuntimeOptions } from '@mcp-layer/gateway';
import { LayerError } from '@mcp-layer/error';
import { DEFAULTS } from './defaults.js';

/**
 * Test whether a value is a plain object.
 * @param {unknown} value - Candidate value.
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Validate GraphQL adapter options.
 * @param {Record<string, unknown>} opts - User options.
 * @returns {{ session: unknown, manager?: { get: (request: import('fastify').FastifyRequest) => Promise<import('@mcp-layer/session').Session>, close?: () => Promise<void> }, prefix?: string | ((version: string, info: Record<string, unknown> | undefined, name: string) => string), validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled: boolean, serviceName: string, metricPrefix: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, endpoint: string, ide: { enabled: boolean, path: string }, operations: { generated: boolean, generic: boolean } }}
 */
export function validateOptions(opts) {
  const base = validateRuntimeOptions(opts, {
    name: 'graphql',
    serviceName: DEFAULTS.telemetry.serviceName
  });

  const input = isRecord(opts) ? opts : {};
  const endpoint = typeof input.endpoint === 'string' && input.endpoint.length > 0
    ? input.endpoint
    : DEFAULTS.endpoint;

  if (!endpoint.startsWith('/')) {
    throw new LayerError({
      name: 'graphql',
      method: 'validateOptions',
      message: 'endpoint must start with "/".'
    });
  }

  const ideInput = isRecord(input.ide) ? input.ide : {};
  const ide = {
    enabled: ideInput.enabled === undefined ? DEFAULTS.ide.enabled : Boolean(ideInput.enabled),
    path: typeof ideInput.path === 'string' && ideInput.path.length > 0 ? ideInput.path : DEFAULTS.ide.path
  };

  if (!ide.path.startsWith('/')) {
    throw new LayerError({
      name: 'graphql',
      method: 'validateOptions',
      message: 'ide.path must start with "/".'
    });
  }

  const operationsInput = isRecord(input.operations) ? input.operations : {};
  const operations = {
    generated: operationsInput.generated === undefined ? DEFAULTS.operations.generated : Boolean(operationsInput.generated),
    generic: operationsInput.generic === undefined ? DEFAULTS.operations.generic : Boolean(operationsInput.generic)
  };

  if (!operations.generated && !operations.generic) {
    throw new LayerError({
      name: 'graphql',
      method: 'validateOptions',
      message: 'operations.generated and operations.generic cannot both be false.'
    });
  }

  return {
    ...base,
    telemetry: {
      ...base.telemetry,
      metricPrefix: 'graphql'
    },
    endpoint,
    ide,
    operations
  };
}
