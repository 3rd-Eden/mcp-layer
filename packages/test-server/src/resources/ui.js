const html = [
  '<!doctype html>',
  '<html lang="en">',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <title>MCP Dashboard</title>',
  '  </head>',
  '  <body>',
  '    <main>',
  '      <h1>Dashboard</h1>',
  '      <p>UI resource served via ui:// scheme.</p>',
  '    </main>',
  '  </body>',
  '</html>',
  ''
].join('\n');

const uri = 'ui://dashboard/app.html';

/**
 * Register the MCP App UI resource.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerUi(server) {
  /**
   * Return HTML for the dashboard UI.
   * @param {URL} url
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').ReadResourceResult>}
   */
  async function ui(url) {
    return {
      contents: [
        {
          uri: url.href,
          mimeType: 'text/html',
          text: html
        }
      ]
    };
  }

  server.registerResource(
    'dashboard-ui',
    uri,
    {
      title: 'Dashboard UI',
      description: 'MCP App UI for the dashboard tool.',
      mimeType: 'text/html',
      _meta: {
        ui: {
          csp: "default-src 'self'",
          permissions: ['clipboard-read']
        }
      }
    },
    ui
  );
}
