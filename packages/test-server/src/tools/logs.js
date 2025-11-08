import { LoggingLevelSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const levels = LoggingLevelSchema.options;

/**
 * Register the logs tool that emits notifications/message entries.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerLogs(server) {
  const inputSchema = {
    level: z.enum(levels),
    message: z.string().min(1),
    logger: z.string().default('diagnostics')
  };

  /**
   * Emit a logging notification honoring the client's configured level filter.
   * @param {{ level: typeof levels[number], message: string, logger: string }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function logsTool(args) {
    await server.sendLoggingMessage({
      level: args.level,
      logger: args.logger,
      data: args.message
    });

    return {
      content: [
        {
          type: 'text',
          text: `Logged ${args.level} message.`
        }
      ],
      structuredContent: {
        level: args.level,
        logger: args.logger
      }
    };
  }

  server.registerTool(
    'logs',
    {
      title: 'Logs',
      description: 'Send notifications/message payloads at the requested level.',
      inputSchema,
      outputSchema: {
        level: z.enum(levels),
        logger: z.string()
      }
    },
    logsTool
  );
}
