import { start } from './index.js';

/**
 * Launch the test MCP server over stdio.
 * @returns {Promise<void>}
 */
async function main() {
  await start();
}

main().catch(function handle(error) {
  console.error(error);
  process.exitCode = 1;
});
