#!/usr/bin/env node

import { run } from '../src/cli.js';

/** @returns {Promise<void>} Run the profile utility. */
async function main() { await run(process.argv.slice(2)); }
main().catch(
  /** @param {unknown} error Command failure. @returns {void} Report a concise failure. */
  function fatal(error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  },
);
