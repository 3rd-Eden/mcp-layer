/**
 * Build runtime defaults for an adapter.
 * @param {string} serviceName - Default telemetry service name.
 * @returns {{ prefix: string | undefined, validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled: boolean, serviceName: string, metricPrefix: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, plugins: Array<Record<string, unknown>>, guardrails: { profile: 'baseline' | 'strict' }, pipeline: { trace: { enabled: boolean, collect: boolean, sink?: (event: Record<string, unknown>) => void } }, policy: { lock: boolean } }}
 */
export function defaults(serviceName) {
  return {
    // Prefix remains optional so adapters can mount at root without forcing an
    // extra segment and still support reverse-proxy path composition.
    prefix: undefined,
    validation: {
      // Auto trust keeps local/stdio schemas fast while distrusting remote
      // schemas unless users explicitly opt in.
      trustSchemas: 'auto',
      maxSchemaDepth: 10,
      maxSchemaSize: 100 * 1024,
      maxPatternLength: 1000,
      maxToolNameLength: 64,
      maxTemplateParamLength: 200,
    },
    resilience: {
      enabled: true,
      timeout: 30000,
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      volumeThreshold: 5,
    },
    telemetry: {
      enabled: false,
      serviceName,
      metricPrefix: 'adapter',
      api: undefined,
    },
    errors: {
      // Avoid leaking upstream details in default adapter responses.
      exposeDetails: false,
    },
    plugins: [],
    guardrails: {
      profile: 'strict'
    },
    pipeline: {
      trace: {
        enabled: false,
        collect: false,
        sink: undefined
      }
    },
    policy: {
      lock: false
    }
  };
}
