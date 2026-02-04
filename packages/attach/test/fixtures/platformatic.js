import fastify from 'fastify';
import mcp from '@platformatic/mcp';

/**
 * Tool handler that returns a structured total.
 * @param {{ left: number, right: number }} input - Tool input payload.
 * @returns {Promise<{ content: { type: string, text: string }[], structuredContent: { total: number } }>}
 */
async function add(input) {
  const total = Number(input.left) + Number(input.right);
  return {
    content: [{ type: 'text', text: String(total) }],
    structuredContent: { total }
  };
}

/**
 * Resource handler that returns a static JSON document.
 * @param {string} uri - Requested resource URI.
 * @returns {Promise<{ contents: { uri: string, text: string, mimeType: string }[] }>}
 */
async function read(uri) {
  return {
    contents: [
      {
        uri,
        text: JSON.stringify({ ok: true }),
        mimeType: 'application/json'
      }
    ]
  };
}

/**
 * Prompt handler that returns a single message.
 * @param {string} name - Prompt name.
 * @param {{ topic?: string }} args - Prompt arguments.
 * @returns {Promise<{ messages: { role: string, content: { type: string, text: string }[] }[] }>}
 */
async function review(name, args) {
  const topic = typeof args?.topic === 'string' ? args.topic : 'topic';
  return {
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: `Review ${topic}` }]
      }
    ]
  };
}

/**
 * Build a Fastify instance with the Platformatic MCP plugin and fixture data.
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
export async function build() {
  const app = fastify({ logger: false });
  await app.register(mcp, {
    serverInfo: { name: 'platformatic-fixture', version: '0.0.0' },
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    }
  });

  app.mcpAddTool(
    {
      name: 'sum',
      description: 'Add two numbers.',
      inputSchema: {
        type: 'object',
        properties: {
          left: { type: 'number' },
          right: { type: 'number' }
        },
        required: ['left', 'right']
      }
    },
    add
  );

  app.mcpAddResource(
    {
      name: 'config',
      uri: 'resource://config',
      mimeType: 'application/json'
    },
    read
  );

  app.mcpAddPrompt(
    {
      name: 'review',
      description: 'Request a review.',
      arguments: [
        {
          name: 'topic',
          description: 'Topic to review.',
          required: false
        }
      ]
    },
    review
  );

  await app.ready();
  return app;
}
