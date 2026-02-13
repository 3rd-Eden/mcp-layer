import { connect } from '@mcp-layer/connect';
import { extract } from '@mcp-layer/schema';
import { runSchema, runTransport } from '@mcp-layer/plugin';
import yoctoSpinner from '@socketregistry/yocto-spinner';
import { select } from './config.js';

/**
 * Create a spinner if allowed.
 * @param {boolean} enabled - Whether the spinner should be active.
 * @param {string} text - Spinner label text.
 * @returns {{ start: () => void, stop: () => void }}
 */
export function spinner(enabled, text) {
  if (!enabled || !process.stdout.isTTY) {
    return { start: function start() {}, stop: function stop() {} };
  }
  const spin = yoctoSpinner({ text });
  return {
    start: function start() {
      spin.start();
    },
    stop: function stop() {
      spin.stop();
    }
  };
}

/**
 * Build spinner text for schema loading.
 * @param {string | undefined} name - Optional server name for display.
 * @returns {string}
 */
export function spinnertext(name) {
  if (name) {
    return `Loading ${name} server data`;
  }
  return 'Loading server data';
}

/**
 * Normalize a value into a plain object.
 * @param {unknown} value - Input value.
 * @returns {Record<string, unknown>}
 */
function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * Extract schema items for a server.
 * @param {{ server?: string, config?: string, spinner: boolean, transport?: string, pipeline?: { transport: any, schema: any, before: any, after: any, error: any }, meta?: Record<string, unknown> }} opts - CLI options for server selection and spinner display.
 * @returns {Promise<{ session: import('@mcp-layer/session').Session, output: { items: Array<Record<string, unknown>>, server: Record<string, unknown> } }>}
 */
export async function catalog(opts) {
  let gate = null;
  let session;
  try {
    const info = await select(opts);
    const transport = opts.pipeline
      ? await runTransport(opts.pipeline, {
        surface: 'transport',
        method: 'transport/connect',
        sessionId: info.name,
        serverName: info.name,
        params: { transport: opts.transport },
        meta: record(opts.meta)
      })
      : { params: { transport: opts.transport } };

    const mode = typeof transport.params?.transport === 'string'
      ? transport.params.transport
      : opts.transport;

    gate = spinner(opts.spinner, spinnertext(info.name));
    gate.start();
    session = await connect(info.config, info.name, { transport: mode });
    const extracted = await extract(session);
    const shaped = opts.pipeline
      ? await runSchema(opts.pipeline, {
        surface: 'schema',
        method: 'schema/extract',
        sessionId: info.name,
        serverName: info.name,
        catalog: extracted,
        meta: record(opts.meta)
      })
      : { catalog: extracted };
    const output = record(shaped.catalog);
    return { session, output };
  } catch (error) {
    if (session) await session.close();
    throw error;
  } finally {
    if (gate) gate.stop();
  }
}
