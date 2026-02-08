import { defaults as runtimeDefaults } from '@mcp-layer/gateway';

const base = runtimeDefaults('mcp-layer-graphql');

/**
 * Default configuration values for the GraphQL plugin.
 * @type {{ prefix: string | undefined, validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled: boolean, serviceName: string, metricPrefix: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, endpoint: string, ide: { enabled: boolean, path: string }, operations: { generated: boolean, generic: boolean } }}
 */
export const DEFAULTS = {
  ...base,
  telemetry: {
    ...base.telemetry,
    metricPrefix: 'graphql'
  },
  endpoint: '/graphql',
  ide: {
    enabled: false,
    path: '/graphiql'
  },
  operations: {
    generated: true,
    generic: true
  }
};
