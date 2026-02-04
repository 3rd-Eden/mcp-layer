import { connect } from '@mcp-layer/connect';
import { extract } from '@mcp-layer/schema';
import yoctoSpinner from '@socketregistry/yocto-spinner';
import { select } from './config.js';

/**
 * Create a spinner if allowed.
 * @param {boolean} enabled
 * @param {string} text
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
 * @param {string | undefined} name
 * @returns {string}
 */
export function spinnertext(name) {
  if (name) {
    return `Loading ${name} server data`;
  }
  return 'Loading server data';
}

/**
 * Extract schema items for a server.
 * @param {{ server?: string, config?: string, spinner: boolean }} opts
 * @returns {Promise<{ session: import('@mcp-layer/session').Session, output: { items: Array<Record<string, unknown>>, server: Record<string, unknown> } }>} 
 */
export async function catalog(opts) {
  let gate = null;
  let session;
  try {
    const info = await select(opts);
    gate = spinner(opts.spinner, spinnertext(info.name));
    gate.start();
    session = await connect(info.config, info.name);
    const output = await extract(session);
    return { session, output };
  } catch (error) {
    if (session) {
      await session.close();
    }
    throw error;
  } finally {
    if (gate) {
      gate.stop();
    }
  }
}
