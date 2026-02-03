import { z } from 'zod';

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3Z5wAAAABJRU5ErkJggg==';
const WAV_BASE64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';

/**
 * Register the present tool to emit mixed content types.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @returns {ReturnType<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer['registerTool']>}
 */
export function registerPresent(server) {
  const inputSchema = {
    title: z.string().min(1, 'Title must be provided')
  };

  /**
   * Emit markdown, image, audio, and resource link content items.
   * @param {{ title: string }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function presentTool(args) {
    const markdown = `# ${args.title}\n\n- Alpha\n- Beta\n\n\`\`\`json\n{\"ok\":true}\n\`\`\``;
    return {
      content: [
        {
          type: 'text',
          text: markdown,
          mimeType: 'text/markdown'
        },
        {
          type: 'image',
          mimeType: 'image/png',
          data: PNG_BASE64
        },
        {
          type: 'audio',
          mimeType: 'audio/wav',
          data: WAV_BASE64
        },
        {
          type: 'resource_link',
          uri: 'resource://manual',
          name: 'Server Manual',
          description: 'Markdown manual for the test server.',
          mimeType: 'text/markdown'
        },
        {
          type: 'resource',
          resource: {
            uri: 'resource://manual',
            mimeType: 'text/markdown',
            text: '# Embedded Manual\n\nUse resources/read for the full manual.'
          }
        }
      ],
      structuredContent: {
        title: args.title,
        types: ['text', 'image', 'audio', 'resource_link', 'resource']
      }
    };
  }

  return server.registerTool(
    'present',
    {
      title: 'Present',
      description: 'Return mixed content types for CLI formatting.',
      inputSchema,
      outputSchema: {
        title: z.string(),
        types: z.array(z.string())
      }
    },
    presentTool
  );
}
