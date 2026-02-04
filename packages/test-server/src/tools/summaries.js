import { z } from 'zod';

/**
 * Register the summaries tool that delegates to sampling/createMessage.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @param {{ hasCapability: (capability: 'sampling') => boolean }} capabilities - Capability checker for sampling support.
 */
export function registerSummaries(server, capabilities) {
  const inputSchema = {
    text: z.string().min(1, 'Text is required'),
    maxTokens: z.number().int().min(64).max(512).default(200)
  };

  /**
   * Request a summary via sampling/createMessage when supported.
   * @param {{ text: string, maxTokens: number }} args - Summary request inputs.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function summaryTool(args) {
    if (!capabilities.hasCapability('sampling')) {
      const notice = 'Connected client did not declare sampling capability.';
      return {
        content: [
          {
            type: 'text',
            text: notice
          }
        ],
        structuredContent: {
          summary: notice,
          usedSampling: false,
          model: null
        }
      };
    }

    try {
      const response = await server.server.createMessage({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Summarize the following text in one sentence.\n\n${args.text}`
            }
          }
        ],
        maxTokens: args.maxTokens
      });
      const summaryText = response.content.type === 'text' ? response.content.text : 'Sampling produced non-text output.';
      return {
        content: [
          {
            type: 'text',
            text: summaryText
          }
        ],
        structuredContent: {
          summary: summaryText,
          usedSampling: true,
          model: response.model
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: message
          }
        ],
        structuredContent: {
          summary: message,
          usedSampling: false,
          model: null
        }
      };
    }
  }

  server.registerTool(
    'summaries',
    {
      title: 'Summaries',
      description: 'Proxy sampling/createMessage to summarize text.',
      inputSchema,
      outputSchema: {
        summary: z.string(),
        usedSampling: z.boolean(),
        model: z.string().nullable()
      }
    },
    summaryTool
  );
}
