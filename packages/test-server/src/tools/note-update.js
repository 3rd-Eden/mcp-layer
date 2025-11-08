import { z } from 'zod';

/**
 * Register a tool that mutates note resources and emits update notifications.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ notes: Map<string, Record<string, string>> }} context
 * @param {{ notifyResourceUpdated: (uri: string) => Promise<void> }} notifier
 */
export function registerNoteUpdate(server, context, notifier) {
  const inputSchema = {
    topic: z.string().min(1),
    detail: z.string().min(1).default('summary'),
    text: z.string().min(1)
  };

  /**
   * Update the referenced note and broadcast notifications/resources/updated.
   * @param {{ topic: string, detail: string, text: string }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function updateNoteTool(args) {
    const topic = args.topic.toLowerCase();
    const entry = context.notes.get(topic) ?? {};
    entry[args.detail] = args.text;
    context.notes.set(topic, entry);
    const uri = `note://${topic}/${args.detail}`;
    await notifier.notifyResourceUpdated(uri);

    return {
      content: [
        {
          type: 'text',
          text: `Updated ${uri}.`
        }
      ],
      structuredContent: {
        uri,
        text: args.text
      }
    };
  }

  server.registerTool(
    'note-update',
    {
      title: 'Note Update',
      description: 'Mutate note:// resources and trigger resources/updated notifications.',
      inputSchema,
      outputSchema: {
        uri: z.string(),
        text: z.string()
      }
    },
    updateNoteTool
  );
}
