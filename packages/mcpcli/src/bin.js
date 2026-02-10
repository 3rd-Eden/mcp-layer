#!/usr/bin/env node

import { createRequire } from 'node:module';
import { cli } from '@mcp-layer/cli';

const read = createRequire(import.meta.url);
const pkg = read('../package.json');

/**
 * Resolve CLI metadata for executable output.
 * @returns {{ name: string, version: string, description: string }}
 */
function meta() {
  return {
    name: 'mcpcli',
    version: typeof pkg.version === 'string' ? pkg.version : '0.0.0',
    description: 'CLI framework for interacting with MCP servers using discovered schemas.'
  };
}

/**
 * Entry point for CLI execution.
 * @returns {Promise<void>}
 */
async function main() {
  await cli(meta()).render();
}

main().catch(function fatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
