import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

export const info = { name: 'mcp-test-server', version: '0.1.0' };
const guide =
  'Echo and Add tools, Manual and Note resources, and Welcome prompts demonstrate a complete MCP server for integration tests.';

const notes = new Map([
  ['echo', 'Echo repeats provided text. Toggle loud to uppercase the response.'],
  ['add', 'Add sums two numbers and returns both text and structured totals.']
]);

/**
 * Build an MCP server instance pre-configured with tools, resources, and prompts.
 * @returns {McpServer}
 */
export function build() {
  const server = new McpServer(info, { instructions: guide });

  const echoArgs = {
    text: z.string().min(1, 'Text must be provided'),
    loud: z.boolean().default(false)
  };

  /**
   * Repeat supplied text and optionally uppercase the response.
   * @param {{ text: string, loud: boolean }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/dist/esm/types.js').CallToolResult>}
   */
  async function echoTool(args) {
    const text = args.loud ? args.text.toUpperCase() : args.text;
    return {
      content: [
        {
          type: 'text',
          text
        }
      ],
      structuredContent: { text, loud: args.loud }
    };
  }

  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Repeat supplied text; uppercase when loud is true.',
      inputSchema: echoArgs,
      outputSchema: {
        text: z.string(),
        loud: z.boolean()
      }
    },
    echoTool
  );

  const addArgs = {
    first: z.number(),
    second: z.number()
  };

  /**
   * Sum two numbers to demonstrate structured responses.
   * @param {{ first: number, second: number }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/dist/esm/types.js').CallToolResult>}
   */
  async function addTool(args) {
    const total = args.first + args.second;
    return {
      content: [
        {
          type: 'text',
          text: `Total: ${total}`
        }
      ],
      structuredContent: { total }
    };
  }

  server.registerTool(
    'add',
    {
      title: 'Add',
      description: 'Combine two numbers and return the sum.',
      inputSchema: addArgs,
      outputSchema: {
        total: z.number()
      }
    },
    addTool
  );

  /**
   * Return a simple manual describing server features.
   * @param {URL} uri
   * @returns {Promise<import('@modelcontextprotocol/sdk/dist/esm/types.js').ReadResourceResult>}
   */
  async function manualRead(uri) {
    return {
      contents: [
        {
          uri: uri.href,
          text: 'This manual outlines tools echo and add along with prompt welcome.'
        }
      ]
    };
  }

  server.registerResource(
    'manual',
    'resource://manual',
    {
      title: 'Server Manual',
      description: 'Describes how to interact with the test server.'
    },
    manualRead
  );

  /**
   * Resolve the topic portion of a note URI.
   * @param {URL} uri
   * @returns {string}
   */
  function noteKey(uri) {
    return uri.hostname || uri.pathname.replace(/^\//, '');
  }

  const template = new ResourceTemplate('note://{topic}', {
    list: async function listNotes() {
      return {
        resources: Array.from(notes.keys()).map(function mapTopics(topic) {
          return {
            uri: `note://${topic}`,
            name: `${topic}-note`,
            description: `Notes covering ${topic}.`
          };
        })
      };
    },
    complete: {
      topic: async function completeTopic(value) {
        return Array.from(notes.keys()).filter(function filterTopics(topic) {
          return topic.startsWith(value);
        });
      }
    }
  });

  /**
   * Read a dynamic note resource for the requested topic.
   * @param {URL} uri
   * @returns {Promise<import('@modelcontextprotocol/sdk/dist/esm/types.js').ReadResourceResult>}
   */
  async function noteRead(uri) {
    const key = noteKey(uri);
    const text = notes.get(key);
    if (!text) {
      return {
        contents: [
          {
            uri: uri.href,
            text: `No note is available for ${key}.`
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
      description: 'Dynamic notes for each tool.'
    },
    noteRead
  );

  const promptArgs = {
    name: z.string().min(1, 'Name is required'),
    tone: z.enum(['casual', 'formal']).default('casual')
  };

  /**
   * Produce a greeting message tailored to the provided tone.
   * @param {{ name: string, tone: 'casual' | 'formal' }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/dist/esm/types.js').GetPromptResult>}
   */
  async function welcomePrompt(args) {
    const base =
      args.tone === 'formal'
        ? `Greetings ${args.name}, welcome to the MCP test server.`
        : `Hey ${args.name}! Enjoy exploring the test server.`;

    return {
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: base
          }
        }
      ]
    };
  }

  server.registerPrompt(
    'welcome',
    {
      title: 'Welcome Prompt',
      description: 'Generate a greeting message with customizable tone.',
      argsSchema: promptArgs
    },
    welcomePrompt
  );

  return server;
}

/**
 * Start the test server using stdio transport for integration scenarios.
 * @param {{ server?: McpServer, transport?: StdioServerTransport }} [opts]
 * @returns {Promise<{ server: McpServer, transport: StdioServerTransport }>}
 */
export async function start(opts = {}) {
  const server = opts.server ?? build();
  const transport = opts.transport ?? new StdioServerTransport();

  // Use stdio transport so callers can spawn this server as a subprocess during tests.
  await server.connect(transport);

  return { server, transport };
}
