import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { load } from '@mcp-layer/config';
import { connect } from '@mcp-layer/connect';
import { attach } from '@mcp-layer/attach';
import { build } from '@mcp-layer/test-server';
import { extract } from '../src/index.js';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const base = path.join(fixtures, 'config.json');
const read = createRequire(import.meta.url);
const serverpkg = read.resolve('@mcp-layer/test-server/package.json');
const entry = path.join(path.dirname(serverpkg), 'src', 'bin.js');

/**
 * Create a temporary directory for schema tests.
 * @returns {Promise<string>}
 */
async function tempdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mcp-layer-schema-'));
}

/**
 * Materialise a config file derived from the base fixture.
 * @param {string} dir
 * @returns {Promise<string>}
 */
async function copyconfig(dir) {
  const file = path.join(dir, 'mcp.json');
  await fs.copyFile(base, file);
  return file;
}

/**
 * Apply runtime command details to the copied config.
 * @param {string} file
 * @returns {Promise<void>}
 */
async function hydrateconfig(file) {
  const raw = await fs.readFile(file, 'utf8');
  const data = JSON.parse(raw);
  data.servers.demo.command = process.execPath;
  data.servers.demo.args = [entry];
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * Find a unified schema entry by type and name.
 * @param {Array<{ type: string, name: string }>} list
 * @param {string} type
 * @param {string} name
 * @returns {{ type: string, name: string } | undefined}
 */
function finditem(list, type, name) {
  return list.find(function match(item) {
    return item.type === type && item.name === name;
  });
}

/**
 * Build an in-process test server for attach coverage.
 * @returns {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer}
 */
function buildserver() {
  return build();
}

describe('schema', function schemaSuite() {
  describe('extract', function extractSuite() {
    it('normalizes tools, resources, prompts, and templates into a unified schema', async function extractCase() {
      const dir = await tempdir();
      const file = await copyconfig(dir);
      await hydrateconfig(file);

      const cfg = await load(undefined, dir);
      const link = await connect(cfg, 'demo');
      let out;

      try {
        out = await extract(link);
      } finally {
        await link.close();
      }

      assert.equal(typeof out, 'object');
      assert.equal(Array.isArray(out.items), true);
      assert.equal(out.server.info.name, 'mcp-test-server');
      assert.equal(out.server.info.version, '0.1.0');

      const tool = finditem(out.items, 'tool', 'files');
      assert.equal(Boolean(tool), true);
      assert.equal(typeof tool.detail.input.schema.safeParse, 'function');
      assert.equal(typeof tool.detail.input.json, 'object');

      const resource = finditem(out.items, 'resource', 'manual');
      assert.equal(Boolean(resource), true);
      assert.equal(resource.detail.uri, 'resource://manual');
      assert.equal(Array.isArray(resource.meta.icons), true);
      assert.equal(typeof resource.meta._meta, 'object');

      const template = finditem(out.items, 'resource-template', 'notes');
      assert.equal(Boolean(template), true);
      assert.equal(template.detail.uriTemplate, 'note://{topic}/{detail}');
      assert.equal(Array.isArray(template.meta.icons), true);
      assert.equal(typeof template.meta._meta, 'object');

      const prompt = finditem(out.items, 'prompt', 'welcome');
      assert.equal(Boolean(prompt), true);
      assert.equal(prompt.detail.input.json.type, 'object');
      assert.equal(Object.hasOwn(prompt.detail.input.json.properties, 'name'), true);
      assert.equal(Object.hasOwn(prompt.detail.input.json.properties, 'tone'), true);

      const dashboard = finditem(out.items, 'tool', 'dashboard');
      assert.equal(Boolean(dashboard), true);
      assert.equal(dashboard.detail.ui.resourceUri, 'ui://dashboard/app.html');

      const ui = out.items.find(function findUi(item) {
        return item.type === 'resource' && item.detail.uri === 'ui://dashboard/app.html';
      });
      assert.equal(Boolean(ui), true);
      assert.equal(ui.detail.ui.csp, "default-src 'self'");
      assert.equal(Array.isArray(ui.detail.ui.permissions), true);
    });
  });

  describe('validation', function validationSuite() {
    it('returns annotation title fallback and omits output schema when absent', async function annotatedCase() {
      const dir = await tempdir();
      const file = await copyconfig(dir);
      await hydrateconfig(file);

      const cfg = await load(undefined, dir);
      const link = await connect(cfg, 'demo');
      let out;

      try {
        out = await extract(link);
      } finally {
        await link.close();
      }

      const annotated = finditem(out.items, 'tool', 'annotated');
      assert.equal(Boolean(annotated), true);
      assert.equal(annotated.title, 'Annotated Tool');
      assert.equal(typeof annotated.meta.annotations, 'object');
      assert.equal(typeof annotated.meta._meta, 'object');
      assert.equal(typeof annotated.detail.output, 'undefined');

      const input = annotated.detail.input.schema.safeParse({ label: 'ok' });
      assert.equal(input.success, true);
    });

    it('throws when extract is called without a Session', async function missingLinkCase() {
      await assert.rejects(async function run() {
        await extract({});
      }, /Expected a Session/);
    });
  });

  describe('attach', function attachSuite() {
    it('extracts from an attached in-process server', async function attachCase() {
      const server = buildserver();
      const session = await attach(server, 'demo');
      let out;

      try {
        out = await extract(session);
      } finally {
        await session.close();
      }

      const tool = finditem(out.items, 'tool', 'echo');
      assert.equal(Boolean(tool), true);
      assert.equal(out.server.info?.name, 'mcp-test-server');
    });
  });
});
