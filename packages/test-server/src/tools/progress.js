import { z } from 'zod';

/**
 * Register the progress tool that emits notifications/progress updates.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 */
export function registerProgress(server) {
  const inputSchema = {
    steps: z.number().int().min(1).max(5).default(3),
    delayMs: z.number().int().min(1).max(200).default(10)
  };

  /**
   * Wait between steps and emit progress notifications when requested.
   * @param {{ steps: number, delayMs: number }} args - Progress configuration inputs.
   * @param {{ _meta?: { progressToken?: string | number }, signal: AbortSignal, sendNotification: (notification: any) => Promise<void> }} extra - Tool execution context and notification helper.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function progressTool(args, extra) {
    const token = extra?._meta?.progressToken;

    /**
     * Sleep helper respecting cancellation.
     * @returns {Promise<void>}
     */
    function sleep() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, args.delayMs);
        extra.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('progress tool aborted'));
          },
          { once: true }
        );
      });
    }

    for (let index = 1; index <= args.steps; index += 1) {
      if (extra.signal.aborted) {
        throw new Error('progress tool aborted');
      }
      await sleep();
      if (token) {
        await extra.sendNotification({
          method: 'notifications/progress',
          params: {
            progressToken: token,
            progress: index,
            total: args.steps,
            message: `step ${index} of ${args.steps}`
          }
        });
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `Completed ${args.steps} steps.`
        }
      ],
      structuredContent: {
        steps: args.steps,
        sentProgress: Boolean(token)
      }
    };
  }

  server.registerTool(
    'progress',
    {
      title: 'Progress',
      description: 'Emit notifications/progress updates for long-running work.',
      inputSchema,
      outputSchema: {
        steps: z.number().int().min(1),
        sentProgress: z.boolean()
      }
    },
    progressTool
  );
}
