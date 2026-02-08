import { validateRuntimeOptions } from '@mcp-layer/gateway';
import { DEFAULTS } from './defaults.js';

/**
 * Validate plugin options and apply defaults.
 * @param {Record<string, unknown>} opts - User-supplied options.
 * @returns {{ session: unknown, manager?: { get: (request: import('fastify').FastifyRequest) => Promise<import('@mcp-layer/session').Session>, close?: () => Promise<void> }, prefix?: string | ((version: string, info: Record<string, unknown> | undefined, name: string) => string), validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled: boolean, serviceName: string, metricPrefix: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, normalizeError?: (error: Error & { code?: string | number }, instance: string, requestId?: string, options?: { exposeDetails?: boolean }) => unknown, exposeOpenAPI: boolean }}
 */
export function validateOptions(opts) {
  const base = validateRuntimeOptions(opts, {
    name: 'rest',
    serviceName: DEFAULTS.telemetry.serviceName
  });

  return {
    ...base,
    telemetry: {
      ...base.telemetry,
      metricPrefix: 'rest'
    },
    exposeOpenAPI: opts.exposeOpenAPI === undefined
      ? DEFAULTS.exposeOpenAPI
      : Boolean(opts.exposeOpenAPI)
  };
}
