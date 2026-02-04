#!/usr/bin/env node

import { cli } from '../../src/index.js';

/**
 * Execute the custom CLI fixture.
 * @returns {Promise<void>}
 */
async function main() {
  await cli({
    name: 'mcp-demo',
    version: '0.1.0',
    description: 'CLI for MCP demo workflows.'
  })
    .command(
      {
        name: 'mcp',
        description: 'Start the MCP server',
        details: 'Starts the MCP server with stdio transport.',
        flags: {
          '--spec': ['Specify spec files'],
          '-s': ['Specify spec files']
        },
        examples: [
          'mcp-demo mcp --spec ./spec1.js ./spec2.json',
          'mcp-demo mcp -s ./my-spec.js'
        ]
      },
      mcpCommand
    )
    .render(process.argv.slice(2));
}

/**
 * Custom command handler for the MCP command.
 * @param {Record<string, unknown>} argv
 * @returns {Promise<void>}
 */
async function mcpCommand(argv) {
  process.stdout.write(`${JSON.stringify({ argv }, null, 2)}\n`);
}

main().catch(function fatal(error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
