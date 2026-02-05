/**
 * Default configuration values for the REST plugin.
 * @type {{ prefix: string | undefined, validation: { trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }, resilience: { enabled: boolean, timeout: number, errorThresholdPercentage: number, resetTimeout: number, volumeThreshold: number }, telemetry: { enabled: boolean, serviceName: string, api?: import('@opentelemetry/api') }, errors: { exposeDetails: boolean }, exposeOpenAPI: boolean }}
 */
export const DEFAULTS = {
  // Prefix is optional so deployments can mount REST routes at the root
  // or under a reverse-proxy path without forcing an extra segment.
  prefix: undefined,
  validation: {
    // Schema trust defaults to auto so local/stdio sessions get fast validation
    // while remote sessions stay safer by default.
    trustSchemas: 'auto',
    // Size and depth limits keep validation bounded for untrusted schemas.
    maxSchemaDepth: 10,
    maxSchemaSize: 100 * 1024,
    // Shorter patterns reduce the surface area for ReDoS-style regex abuse.
    maxPatternLength: 1000,
    // Tool names should be short, URL-safe segments to avoid route ambiguity.
    maxToolNameLength: 64,
    // Template parameter values can be large; cap to avoid oversized URIs.
    maxTemplateParamLength: 200,
  },
  resilience: {
    // Circuit breakers are enabled by default to keep MCP outages from
    // cascading through downstream HTTP clients.
    enabled: true,
    // Timeout and thresholds mirror opossum defaults to avoid surprises when
    // users pass through additional opossum options.
    timeout: 30000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
    volumeThreshold: 5,
  },
  telemetry: {
    // Telemetry is opt-in because OpenTelemetry is an optional peer dependency.
    enabled: false,
    serviceName: 'mcp-layer-rest',
    // Allow injecting an OpenTelemetry API instance so callers can opt in
    // without relying on dynamic module loading.
    api: undefined,
  },
  // Error detail exposure defaults to false to avoid leaking internal messages.
  errors: {
    exposeDetails: false,
  },
  // Expose OpenAPI by default to keep REST and schema generation aligned.
  exposeOpenAPI: true,
};
