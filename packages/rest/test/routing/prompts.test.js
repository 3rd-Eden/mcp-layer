import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { closeTestApp, createTestApp } from '../helpers.js';
import { attach } from '@mcp-layer/attach';
import Fastify from 'fastify';
import mcpRest from '@mcp-layer/rest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Execute prompt routing tests.
 * @returns {void}
 */
function promptSuite() {
  it('invokes prompts via POST /prompts/{name}', async function promptCase() {
    const app = await createTestApp();

    try {
      const res = await app.fastify.inject({
        method: 'POST',
        url: '/v0/prompts/welcome',
        payload: { name: 'Ada', tone: 'cheerful' }
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.equal(body.messages[0].content.text.includes('Ada'), true);
    } finally {
      await closeTestApp(app);
    }
  });

  it('rejects invalid prompt names', async function invalidCase() {
    const server = buildPromptServer('bad/name');
    const session = await attach(server, 'prompt');
    const fastify = Fastify({ logger: false });

    try {
      await assert.rejects(
        async function run() {
          await fastify.register(mcpRest, { session });
        },
        /url-safe/i
      );
    } finally {
      await fastify.close();
      await session.close();
      await server.close();
    }
  });
}

describe('prompt routing', promptSuite);

/**
 * Build a minimal MCP server with a custom prompt.
 *
 *
 * @param {string} name - Prompt name.
 * @returns {McpServer}
 */
function buildPromptServer(name) {
  const server = new McpServer({ name: 'prompt-test', version: '0.1.0' });

  /**
   * Render a prompt response.
   * @returns {Promise<{ messages: Array<{ role: string, content: { type: string, text: string } }> }>}
   */
  async function renderPrompt() {
    return {
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: 'ok'
          }
        }
      ]
    };
  }

  server.registerPrompt(
    name,
    {
      title: 'Prompt Test',
      description: 'Prompt test definition.'
    },
    renderPrompt
  );

  return server;
}
