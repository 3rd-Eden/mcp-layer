import { setTimeout } from 'node:timers/promises';
import { cli } from '../../src/index.js';
import { browser } from './browser.mjs';

/** @param {URL} url Authorization URL. @returns {Promise<void>} Real consent after a human-like delay. */
async function delayed(url) { await setTimeout(500); await browser(url); }
/** @returns {Promise<void>} Exercise the public builder with a slow real consent interaction. */
async function main() { await cli({ open: delayed }).render(); }
main().catch(
  /**
   * Report the real CLI failure and exit nonzero.
   * @param {Error} error Actual process or request failure.
   * @returns {void} Completion of the real test operation.
   */
  function fatal(error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
