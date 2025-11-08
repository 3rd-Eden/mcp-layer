import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Register the dynamic notes resource template with completions.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 * @param {{ notes: Map<string, Record<string, string>> }} context
 */
export function registerNotesResource(server, context) {
  const template = new ResourceTemplate('note://{topic}/{detail}', {
    list: async function listNotes() {
      return {
        resources: Array.from(context.notes.entries()).flatMap(function mapNotes([topic, detailSet]) {
          return Object.keys(detailSet).map(function mapDetail(detail) {
            return {
              uri: `note://${topic}/${detail}`,
              name: `${topic}-${detail}`,
              description: `Notes covering ${topic} (${detail}).`
            };
          });
        })
      };
    },
    complete: {
      topic: async function completeTopic(value) {
        const match = value.toLowerCase();
        return Array.from(context.notes.keys()).filter(function filterTopics(topic) {
          return topic.startsWith(match);
        });
      },
      detail: async function completeDetail(value, completionContext) {
        const topic = completionContext?.arguments?.topic;
        const pool = topic && context.notes.get(topic) ? Object.keys(context.notes.get(topic)) : ['summary', 'usage'];
        return pool.filter(function filterDetail(entry) {
          return entry.startsWith(value);
        });
      }
    }
  });

  /**
   * Derive note topic and detail for a URI or template variable set.
   * @param {URL} uri
   * @param {{ topic?: string, detail?: string }} [variables]
   * @returns {{ topic: string, detail: string }}
   */
  function noteParts(uri, variables = {}) {
    const topic = variables.topic ?? uri.hostname ?? uri.pathname.replace(/^\//, '');
    const rawDetail = variables.detail ?? uri.pathname.replace(/^\//, '');
    const detail = rawDetail || 'summary';
    return { topic, detail };
  }

  /**
   * Read a dynamic note resource for the requested topic/detail pair.
   * @param {URL} uri
   * @param {{ topic?: string, detail?: string }} [variables]
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').ReadResourceResult>}
   */
  async function noteRead(uri, variables = {}) {
    const parts = noteParts(uri, variables);
    const topicNotes = context.notes.get(parts.topic);
    const text = topicNotes?.[parts.detail];
    if (!text) {
      return {
        contents: [
          {
            uri: uri.href,
            text: `No ${parts.detail} note is available for ${parts.topic}.`
          }
        ]
      };
    }

    return {
      contents: [
        {
          uri: uri.href,
          text
        }
      ]
    };
  }

  server.registerResource(
    'notes',
    template,
    {
      title: 'Feature Notes',
      description: 'Dynamic notes for each feature, including summaries and usage guidance.',
      mimeType: 'text/plain'
    },
    noteRead
  );
}
