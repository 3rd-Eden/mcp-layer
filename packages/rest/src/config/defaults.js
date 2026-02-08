import { defaults } from '@mcp-layer/gateway';

const base = defaults('mcp-layer-rest');

/**
 * Default configuration values for the REST plugin.
 * @type {{ prefix: string | undefined, validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled: boolean, serviceName: string, metricPrefix: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, exposeOpenAPI: boolean }}
 */
export const DEFAULTS = {
  ...base,
  telemetry: {
    ...base.telemetry,
    metricPrefix: 'rest'
  },
  // Expose OpenAPI by default to keep REST and schema generation aligned.
  exposeOpenAPI: true,
};
