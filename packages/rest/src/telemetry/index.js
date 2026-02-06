import { createRequire } from 'node:module';

/**
 * Load the OpenTelemetry API module dynamically.
 *
 *
 * @returns {import('@opentelemetry/api')} OTel API module.
 */
function loadOtel() {
  const req = createRequire(import.meta.url);
  return req('@opentelemetry/api');
}

/**
 * Create a telemetry helper for the REST plugin.
 *
 * forcing consumers to install an SDK if they do not opt in.
 *
 * @param {{ enabled?: boolean, serviceName: string, api?: import('@opentelemetry/api') }} config - Telemetry configuration.
 * @returns {{ tracer: import('@opentelemetry/api').Tracer, meter: import('@opentelemetry/api').Meter, context: import('@opentelemetry/api').ContextAPI, propagation: import('@opentelemetry/api').PropagationAPI, metrics: { callDuration: import('@opentelemetry/api').Histogram, callErrors: import('@opentelemetry/api').Counter, validationErrors: import('@opentelemetry/api').Counter, circuitState: import('@opentelemetry/api').ObservableGauge }, setCircuitState: (session: string, state: string) => void } | null}
 */
export function createTelemetry(config) {
  const enabled = config.enabled ?? Boolean(config.api);
  if (!enabled) return null;

  const otel = config.api ?? loadOtel();
  const tracer = otel.trace.getTracer(config.serviceName, '1.0.0');
  const meter = otel.metrics.getMeter(config.serviceName, '1.0.0');

  const callDuration = meter.createHistogram('mcp.call.duration', {
    description: 'Duration of MCP calls',
    unit: 'ms'
  });

  const callErrors = meter.createCounter('mcp.call.errors', {
    description: 'Number of MCP call errors'
  });

  const validationErrors = meter.createCounter('rest.validation.errors', {
    description: 'Number of validation errors'
  });

  const states = new Map();
  const circuitState = meter.createObservableGauge('rest.circuit.state', {
    description: 'Circuit breaker state'
  });

  circuitState.addCallback(function observe(obs) {
    for (const [session, value] of states.entries()) {
      obs.observe(value, { session });
    }
  });

  /**
   * Update circuit breaker state metric.
   * @param {string} session - Session name.
   * @param {string} state - Circuit breaker state.
   * @returns {void}
   */
  function setCircuitState(session, state) {
    const map = { open: 2, half_open: 1, closed: 0 };
    const value = Object.prototype.hasOwnProperty.call(map, state) ? map[state] : 0;
    states.set(session, value);
  }

  return {
    tracer,
    meter,
    context: otel.context,
    propagation: otel.propagation,
    metrics: {
      callDuration,
      callErrors,
      validationErrors,
      circuitState
    },
    setCircuitState
  };
}
