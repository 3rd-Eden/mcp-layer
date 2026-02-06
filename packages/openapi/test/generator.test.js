import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spec } from '../src/generator.js';
import { build } from '../../test-server/src/index.js';
import { attach } from '@mcp-layer/attach';
import { extract } from '@mcp-layer/schema';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * Resolve the fixtures directory for this test file.
 *
 * avoiding brittle relative path math in the test body.
 *
 * @returns {string}
 */
function fixtureDir() {
  return join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
}

/**
 * Resolve the OpenAPI fixture path.
 * @returns {string}
 */
function specFixturePath() {
  return join(fixtureDir(), 'spec.json');
}

/**
 * Load the OpenAPI JSON fixture.
 * @returns {Record<string, unknown>}
 */
function loadSpecFixture() {
  const raw = readFileSync(specFixturePath(), 'utf8');
  return JSON.parse(raw);
}

/**
 * Normalize spec object for stable comparison.
 *
 *
 * @param {Record<string, unknown>} spec - OpenAPI spec object.
 * @returns {Record<string, unknown>}
 */
function normalizeSpec(spec) {
  return JSON.parse(JSON.stringify(spec));
}

/**
 * Extract a catalog from the test MCP server.
 *
 * not hand-crafted fixtures.
 *
 * @returns {Promise<{ server?: { info?: Record<string, unknown> }, items?: Array<Record<string, unknown>> }>}
 */
async function loadCatalog() {
  const server = build();
  const session = await attach(server, 'openapi');

  try {
    return await extract(session);
  } finally {
    await session.close();
  }
}

/**
 * Build a minimal MCP server with a custom template.
 *
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

/**
 * Execute OpenAPI generator tests.
 * @returns {void}
 */
function generatorSuite() {
  it('generates OpenAPI 3.1 spec with expected paths', async function generateSpecCase() {
    const catalog = await loadCatalog();
    const doc = spec(catalog, {
      title: 'MCP Test Server REST API',
      version: '0.1.0',
      prefix: '/v1'
    });

    assert.equal(doc.openapi, '3.1.0');
    assert.equal(doc.info.title, 'MCP Test Server REST API');
    assert.equal(doc.info.version, '0.1.0');
    assert.ok(doc.paths['/v1/template/note/{name}']);
    assert.equal(doc.paths['/v1/template/note/{name}'].get.parameters?.[0]?.name, 'name');

    const fixture = loadSpecFixture();
    const normalized = normalizeSpec(doc);
    assert.deepStrictEqual(normalized, fixture);
  });

  it('rejects unsupported template expressions', async function templateCase() {
    const server = buildTemplateServer('tmpl://note/{+name}');
    const session = await attach(server, 'tmpl');

    try {
      const catalog = await extract(session);
      assert.throws(
        function run() {
          spec(catalog, { prefix: '/v1' });
        },
        /not supported/i
      );
    } finally {
      await session.close();
      await server.close();
    }
  });

  it('rejects invalid prompt names', async function promptCase() {
    const server = buildPromptServer('bad/name');
    const session = await attach(server, 'prompt');

    try {
      const catalog = await extract(session);
      assert.throws(
        function run() {
          spec(catalog, { prefix: '/v1' });
        },
        /url-safe/i
      );
    } finally {
      await session.close();
      await server.close();
    }
  });
}

describe('openapi generator', generatorSuite);
