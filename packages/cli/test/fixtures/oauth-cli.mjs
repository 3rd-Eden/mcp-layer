import { cli } from '../../src/index.js';
import { browser } from './browser.mjs';

/** @returns {Promise<void>} Run the public CLI builder with a real HTTP browser interaction. */
async function main() { await cli({ open: browser }).render(); }
main().catch(
  /**
   * Report the real CLI failure and exit nonzero.
   * @param {Error} error Actual process or request failure.
   * @returns {void} Completion of the real test operation.
   */
  function fatal(error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
