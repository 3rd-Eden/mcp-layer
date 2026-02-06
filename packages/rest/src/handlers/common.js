import { createAuthResponse, createCircuitOpenResponse, createMcpErrorResponse } from '../errors/mapping.js';

/**
 * Create telemetry helpers for a request.
 *
 *
 * @param {{ telemetry: ReturnType<import('../telemetry/index.js').createTelemetry> | null, spanName: string, attributes: Record<string, unknown>, labels: Record<string, string>, validationLabels?: Record<string, string> }} config - Telemetry context.
 * @returns {{ recordValidation: () => void, recordSuccess: () => void, recordError: (error: Error & { code?: string | number }) => void, recordStatus: (status: string, errorType?: string | number) => void, finish: () => void }}
 */
export function createCallContext(config) {
  const start = Date.now();
  const span = config.telemetry
    ? config.telemetry.tracer.startSpan(config.spanName, { attributes: config.attributes })
    : null;

  /**
   * Record a validation error in telemetry.
   * @returns {void}
   */
  function recordValidation() {
    if (config.telemetry) {
      config.telemetry.metrics.validationErrors.add(1, config.validationLabels ?? {});
    }
    if (span) {
      span.setStatus({ code: 2, message: 'Validation failed' });
    }
  }

  /**
   * Record a successful call in telemetry.
   * @returns {void}
   */
  function recordSuccess() {
    if (config.telemetry) {
      config.telemetry.metrics.callDuration.record(Date.now() - start, {
        ...config.labels,
        status: 'success'
      });
    }
    if (span) {
      span.setStatus({ code: 1 });
    }
  }

  /**
   * Record an error call in telemetry.
   * @param {Error & { code?: string | number }} error - Error that occurred.
   * @returns {void}
   */
  function recordError(error) {
    if (config.telemetry) {
      config.telemetry.metrics.callErrors.add(1, {
        ...config.labels,
        error_type: error.code || 'unknown'
      });
      config.telemetry.metrics.callDuration.record(Date.now() - start, {
        ...config.labels,
        status: 'error'
      });
    }
    if (span) {
      span.recordException(error);
      span.setStatus({ code: 2, message: error.message });
    }
  }

  /**
   * Record a custom status in telemetry.
   * @param {string} status - Status label to record.
   * @param {string | number} [errorType] - Optional error type label.
   * @returns {void}
   */
  function recordStatus(status, errorType) {
    if (config.telemetry) {
      if (errorType !== undefined) {
        config.telemetry.metrics.callErrors.add(1, {
          ...config.labels,
          error_type: errorType
        });
      }
      config.telemetry.metrics.callDuration.record(Date.now() - start, {
        ...config.labels,
        status
      });
    }
    if (span && status !== 'success') {
      span.setStatus({ code: 2, message: String(status) });
    }
  }

  /**
   * Close the span, if any.
   * @returns {void}
   */
  function finish() {
    if (span) span.end();
  }

  return { recordValidation, recordSuccess, recordError, recordStatus, finish };
}

/**
 * Map an MCP error to an HTTP response.
 *
 *
 * @param {Error & { code?: string | number, sessionName?: string }} error - Error from MCP call.
 * @param {string} instance - Request path.
 * @param {string} [requestId] - Request identifier.
 * @param {{ exposeDetails?: boolean }} [options] - Error detail options.
 * @returns {{ status: number, body: Record<string, unknown> }}
 */
export function mapMcpError(error, instance, requestId, options) {
  if (error.code === 'CIRCUIT_OPEN') {
    const response = createCircuitOpenResponse(instance, error.sessionName, requestId);
    return { status: response.status, body: response };
  }
  if (error.code === 'AUTH_REQUIRED') {
    const response = createAuthResponse(instance, 'Unauthorized', 'Authorization is required.', requestId);
    return { status: response.status, body: response };
  }
  if (error.code === 'AUTH_INVALID') {
    const response = createAuthResponse(instance, 'Unauthorized', 'Authorization is invalid.', requestId);
    return { status: response.status, body: response };
  }

  const response = createMcpErrorResponse(error, instance, requestId, options);
  return { status: response.status, body: response };
}
