import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import { build } from '../../../test-server/src/index.js';
import mcpRest from '@mcp-layer/rest';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Execute resource template routing tests.
 * @returns {void}
 */
function templateSuite() {
  it('lists resource templates', async function listCase() {
    const server = build();
    const session = await attach(server, 'templates');
    const fastify = Fastify({ logger: false });

    try {
      await fastify.register(mcpRest, { session });
      const res = await fastify.inject({
        method: 'GET',
        url: '/v0/resource-templates'
      });

      assert.equal(res.statusCode, 200);
      const body = res.json();
      assert.ok(Array.isArray(body.templates));
      assert.equal(body.templates.length > 0, true);
    } finally {
      await fastify.close();
      await session.close();
      await server.close();
    }
  });

  it('serves templated resources as dynamic routes', async function templateCase() {
    const server = build();
    const session = await attach(server, 'templates');
    const fastify = Fastify({ logger: false });

    try {
      await fastify.register(mcpRest, { session });
      const res = await fastify.inject({
        method: 'GET',
        url: '/v0/template/note/Ada'
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.includes('Template note for Ada.'), true);
    } finally {
      await fastify.close();
      await session.close();
      await server.close();
    }
  });

  it('rejects template params that exceed length limits', async function limitCase() {
    const server = build();
    const session = await attach(server, 'templates');
    const fastify = Fastify({ logger: false });

    try {
      await fastify.register(mcpRest, {
        session,
        validation: {
          maxTemplateParamLength: 3
        }
      });
      const res = await fastify.inject({
        method: 'GET',
        url: '/v0/template/note/Adaline'
      });

      assert.equal(res.statusCode, 400);
      const body = res.json();
      assert.ok(String(body.type).includes('error-validation'));
    } finally {
      await fastify.close();
      await session.close();
      await server.close();
    }
  });

  it('rejects unsupported template expressions', async function unsupportedCase() {
    const server = buildTemplateServer('tmpl://note/{+name}');
    const session = await attach(server, 'templates');
    const fastify = Fastify({ logger: false });

    try {
      await assert.rejects(
        async function run() {
          await fastify.register(mcpRest, { session });
        },
        /not supported/i
      );
    } finally {
      await fastify.close();
      await session.close();
      await server.close();
    }
  });
}

describe('resource template routing', templateSuite);

/**
 * Build a minimal MCP server with a custom template.
 *
 * Why this exists: tests need to verify template validation on plugin startup.
 *
 * @param {string} template - URI template string.
 * @returns {McpServer}
 */
function buildTemplateServer(template) {
  const server = new McpServer({ name: 'template-test', version: '0.1.0' });
  const tmpl = new ResourceTemplate(template, {});

  /**
   * Read the templated resource.
   * @param {URL} uri - Expanded URI.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').ReadResourceResult>}
   */
  async function readTemplate(uri) {
    return {
      contents: [
        {
          uri: uri.href,
          text: 'ok',
          mimeType: 'text/plain'
        }
      ]
    };
  }

  server.registerResource(
    'template-test',
    tmpl,
    {
      title: 'Template Test',
      description: 'Template test resource.',
      mimeType: 'text/plain'
    },
    readTemplate
  );

  return server;
}
