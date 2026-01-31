/**
 * Register the markdown manual resource.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ manual: string }} context
 */
export function registerManualResource(server, context) {
  /**
   * Return a markdown manual describing server features.
   * @param {URL} uri
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').ReadResourceResult>}
   */
  async function manualRead(uri) {
    return {
      contents: [
        {
          uri: uri.href,
          text: context.manual
        }
      ]
    };
  }

  server.registerResource(
    'manual',
    'resource://manual',
    {
      title: 'Server Manual',
      description: 'Describes how to interact with the test server.',
      mimeType: 'text/markdown',
      icons: [
        {
          src: 'https://example.test/assets/manual.png',
          mimeType: 'image/png',
          sizes: ['48x48']
        }
      ],
      _meta: {
        owner: 'mcp-layer-schema'
      }
    },
    manualRead
  );
}
