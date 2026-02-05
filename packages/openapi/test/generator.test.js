import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spec } from '../src/generator.js';
import { build } from '../../test-server/src/index.js';
import { attach } from '@mcp-layer/attach';
import { extract } from '@mcp-layer/schema';

/**
 * Resolve the fixtures directory for this test file.
 *
 * Why this exists: keep snapshot files colocated with the test suite while
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
 * Why this exists: JSON serialization strips `undefined`, matching snapshot files.
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
 * Why this exists: ensures the generator reflects real MCP catalog output,
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
}

describe('openapi generator', generatorSuite);
