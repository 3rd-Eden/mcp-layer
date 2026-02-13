import { runService } from './service.js';

/**
 * Parse optional service options from environment.
 * @returns {Record<string, unknown>}
 */
function options() {
  const raw = process.env.MCP_LAYER_STATEFUL_OPTIONS;
  if (!raw) return {};

  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}

runService(options()).catch(function fatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
