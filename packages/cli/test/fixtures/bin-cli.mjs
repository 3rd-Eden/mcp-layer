#!/usr/bin/env node

import { cli } from '../../src/index.js';

/**
 * Entry point for CLI execution.
 * @returns {Promise<void>}
 */
async function main() {
  await cli().render();
}

main().catch(function fatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
