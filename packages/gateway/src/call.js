/**
 * Create telemetry helpers for a request lifecycle.
 * @param {{ telemetry: ReturnType<import('./telemetry/index.js').createTelemetry> | null, spanName: string, attributes: Record<string, unknown>, labels: Record<string, string>, validationLabels?: Record<string, string> }} config - Telemetry context.
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
