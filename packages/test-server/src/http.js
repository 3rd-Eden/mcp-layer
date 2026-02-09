import { startHttpServer } from './transport/http.js';
import { LayerError } from '@mcp-layer/error';
import argh from 'argh';

/**
 * Parse CLI arguments for the HTTP test-server binary.
 * @returns {{ port?: unknown }}
 */
function args() {
  return argh(process.argv.slice(2));
}

/**
 * Parse the optional CLI port value.
 * @param {{ port?: unknown }} parsed - Parsed CLI argument map.
 * @returns {number | undefined}
 */
function port(parsed) {
  const value = parsed.port;
  if (value === undefined) return undefined;

  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 65535) {
    throw new LayerError({
      name: 'test-server',
      method: 'port',
      message: 'Invalid --port value "{value}".',
      vars: { value }
    });
  }

  return number;
}

/**
 * Start the HTTP test server process.
 * @returns {Promise<void>}
 */
async function main() {
  await startHttpServer({ port: port(args()) });
}

main().catch(function handle(error) {
  console.error(error);
  process.exitCode = 1;
});
