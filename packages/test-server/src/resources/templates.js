import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register a templated resource that expands a name into a note URI.
 *
 * surface to exercise dynamic routes.
 *
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register resources on.
 */
export function registerTemplateResource(server) {
  const template = new ResourceTemplate('template://note/{name}', {});

  /**
   * Read a templated note resource.
   * @param {URL} uri - Expanded resource URI.
   * @param {{ name?: string }} variables - Template variables.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').ReadResourceResult>}
   */
  async function templateRead(uri, variables) {
    const name = variables && typeof variables.name === 'string' ? variables.name : 'unknown';
    return {
      contents: [
        {
          uri: uri.href,
          text: `Template note for ${name}.`,
          mimeType: 'text/plain'
        }
      ]
    };
  }

  server.registerResource(
    'note-template',
    template,
    {
      title: 'Template Note',
      description: 'Dynamic note template resource.',
      mimeType: 'text/plain'
    },
    templateRead
  );
}
