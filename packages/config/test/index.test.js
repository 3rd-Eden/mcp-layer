import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Config, locate, load } from '../src/index.js';
import { claudeCode } from '../src/connectors/claude-code.js';
import { codex } from '../src/connectors/codex.js';

const fixturesRoot = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (...segments) => path.join(fixturesRoot, ...segments);
const tempdir = (prefix) => fs.mkdtemp(path.join(os.tmpdir(), prefix));

describe('config', function configSuite() {
  describe('locate', function locateSuite() {
    it('finds mcp.json in provided start directory', async function locateFindCase() {
      const dir = fixture('claude/project');
      const list = await locate({ start: dir });

      assert.equal(Array.isArray(list), true);
      assert.equal(list[0].path, path.join(dir, '.mcp.json'));
    });
  });

  describe('load', function loadSuite() {
    it('returns parsed server map from located config', async function loadMapCase() {
      const dir = fixture('claude/project');
      const info = await load(undefined, dir);

      assert.equal(info instanceof Config, true);
      assert.equal(info.map instanceof Map, true);
      assert.equal(info.map.has('demo'), true);
      const entry = info.get('demo');
      assert.equal(entry?.source, path.join(dir, '.mcp.json'));
      assert.deepEqual(entry?.config, { command: 'demo' });
    });

    it('detects cursor specific configuration locations', async function loadCursorCase() {
      const dir = fixture('cursor/project');
      const info = await load(undefined, dir);

      const file = path.join(dir, '.cursor', 'mcp.json');
      const item = info.get('demo');
      assert.equal(item?.source, file);
      assert.deepEqual(item?.config, { command: 'cursor' });
    });

    it('parses codex config.toml', async function loadCodexCase() {
      const workspace = fixture('codex/workspace');
      const homeDir = fixture('codex/home');
      const info = await load(undefined, { start: workspace, homeDir });

      const file = path.join(homeDir, '.codex', 'config.toml');
      const item = info.get('demo');
      assert.equal(item?.source, file);
      assert.deepEqual(item?.config, { command: 'codex', args: ['--flag'], env: { TOKEN: 'secret' } });
    });

    it('records vscode metadata inputs', async function loadVSCodeCase() {
      const dir = fixture('vscode/project');
      const info = await load(undefined, dir);

      const file = path.join(dir, '.vscode', 'mcp.json');
      const item = info.get('store');
      assert.equal(item?.source, file);
      assert.deepEqual(item?.config, { type: 'http', url: 'https://example.test/mcp' });
      assert.deepEqual(info.list[0].data.metadata, {
        inputs: [
          { id: 'token', type: 'promptString', description: 'API token', password: true }
        ]
      });
    });

    it('uses inline configuration when provided', async function loadInlineCase() {
      const info = await load({
        servers: {
          manual: {
            command: '/usr/local/bin/manual'
          },
          ignore: null
        },
        inputs: [{ id: 'token', type: 'promptString' }],
        defaultMode: 'manual'
      }, '/virtual/manual.json');

      const item = info.get('manual');
      assert.equal(item?.source, '/virtual/manual.json');
      assert.deepEqual(item?.config, { command: '/usr/local/bin/manual' });
      assert.deepEqual(info.list[0].data.metadata, { inputs: [{ id: 'token', type: 'promptString' }], defaultMode: 'manual' });
    });

    it('throws when inline document lacks mcpServers', async function loadInlineMissingServersCase() {
      await assert.rejects(load({ inputs: [] }, '/virtual/empty'), /declare at least one server/);
    });

    it('loads generic YAML and JSON configs via glob discovery', async function loadGenericCase() {
      const dir = fixture('generic/project');
      const info = await load(undefined, dir);

      const yamlFile = path.join(dir, 'mcp.tools.yaml');
      const yamlServer = info.get('yaml-server');
      assert.equal(yamlServer?.source, yamlFile);
      assert.deepEqual(yamlServer?.config, { url: 'https://example.test/yaml', headers: { Authorization: 'Bearer token' } });

      const jsonFile = path.join(dir, 'fallback.mcp.json');
      const jsonServer = info.get('json-server');
      assert.equal(jsonServer?.source, jsonFile);
      assert.deepEqual(jsonServer?.config, { command: 'json-cli', args: ['--stdio'] });
    });

    it('discovers gemini CLI settings', async function loadGeminiCase() {
      const dir = fixture('gemini/project');
      const info = await load(undefined, dir);

      const file = path.join(dir, '.gemini', 'settings.json');
      const geminiServer = info.get('gemini');
      assert.equal(geminiServer?.connector, 'gemini-cli');
      assert.equal(geminiServer?.source, file);
      assert.deepEqual(geminiServer?.config, { command: 'gemini-cli' });
    });
  });

  describe('Config', function configClassSuite() {
    it('throws when consuming without parser or data', async function consumeFailureCase() {
      const config = new Config();
      await assert.rejects(config.consume({ path: '/tmp/missing' }), /No parser or data supplied/);
    });

    it('overwrites existing list entries on repeated consume', async function consumeOverwriteCase() {
      const dir = await tempdir('consume-overwrite-');
      const file = path.join(dir, '.mcp.json');
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(file, JSON.stringify({ mcpServers: { one: { command: 'one' } } }, null, 2), 'utf8');

      const config = new Config();
      await config.consume({
        path: file,
        connector: 'claude-code',
        scope: 'project',
        parse(raw, filepath) {
          return claudeCode.parse(raw, filepath);
        }
      });

      await fs.writeFile(file, JSON.stringify({ mcpServers: { two: { command: 'two' } } }, null, 2), 'utf8');

      await config.consume({
        path: file,
        connector: 'claude-code',
        scope: 'project',
        parse(raw, filepath) {
          return claudeCode.parse(raw, filepath);
        }
      });

      assert.equal(config.list.length, 1);
      assert.deepEqual(config.list[0].data.servers, [{ name: 'two', config: { command: 'two' } }]);
    });

    it('updates existing servers via add', async function upsertExistingCase() {
      const dir = await tempdir('claude-upsert-');
      const file = path.join(dir, '.mcp.json');
      await fs.copyFile(fixture('claude/project/.mcp.json'), file);

      const info = await load(undefined, dir);
      await info.add({ name: 'demo', config: { command: 'updated' } });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.demo, { command: 'updated' });
      const entry = info.get('demo');
      assert.equal(entry?.config.command, 'updated');
      assert.equal(entry?.connector, 'claude-code');
    });

    it('adds new servers when provided with connector', async function upsertNewCase() {
      const dir = await tempdir('claude-upsert-new-');
      const file = path.join(dir, '.mcp.json');
      await fs.copyFile(fixture('claude/project/.mcp.json'), file);

      const info = await load(undefined, dir);
      await assert.rejects(info.add({ name: 'brand', config: { command: 'brand' } }), /Connector is required/);

      await info.add({ name: 'brand', config: { command: 'brand' } }, { connector: 'claude-code' });
      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.brand, { command: 'brand' });
      const brandEntry = info.get('brand');
      assert.equal(brandEntry?.connector, 'claude-code');
      assert.equal(brandEntry?.config.command, 'brand');
    });

    it('selects scoped files when provided', async function scopedAddCase() {
      const projectDir = await tempdir('claude-scope-project-');
      await fs.copyFile(fixture('claude/project/.mcp.json'), path.join(projectDir, '.mcp.json'));

      const homeDir = await tempdir('claude-scope-home-');
      await fs.mkdir(homeDir, { recursive: true });
      await fs.copyFile(fixture('claude/home/.mcp.json'), path.join(homeDir, '.mcp.json'));

      const config = await load(undefined, { start: projectDir, homeDir, env: {} });

      await config.add({ name: 'home-only', config: { command: 'home-only' } }, { connector: 'claude-code', scope: 'home' });

      const projectDoc = JSON.parse(await fs.readFile(path.join(projectDir, '.mcp.json'), 'utf8'));
      assert.deepEqual(projectDoc.mcpServers, { demo: { command: 'demo' } });

      const homeDoc = JSON.parse(await fs.readFile(path.join(homeDir, '.mcp.json'), 'utf8'));
      assert.equal(Object.hasOwn(homeDoc.mcpServers, 'home-only'), true);
      assert.deepEqual(homeDoc.mcpServers['home-only'], { command: 'home-only' });
    });

    it('removes server entries when requested', async function removeCase() {
      const dir = await tempdir('claude-remove-');
      const file = path.join(dir, '.mcp.json');
      await fs.copyFile(fixture('claude/project/.mcp.json'), file);

      const info = await load(undefined, dir);
      await info.remove('demo');

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.equal(Object.hasOwn(doc.mcpServers, 'demo'), false);
      assert.equal(info.get('demo'), undefined);
    });

    it('preserves remaining codex servers on removal', async function codexRemovePreserveCase() {
      const workspace = fixture('codex/workspace');
      const homeDir = await tempdir('codex-remove-');
      const file = path.join(homeDir, '.codex', 'config.toml');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.copyFile(fixture('codex/home/.codex/config.toml'), file);

      const config = await load(undefined, { start: workspace, homeDir, env: {} });
      await config.add({ name: 'aux', config: { command: 'codex-aux' } }, { connector: 'codex', file });

      await config.remove('demo');

      const parsed = codex.parse(await fs.readFile(file, 'utf8'), file);
      assert.equal(parsed.servers.some(function hasDemo(entry) {
        return entry.name === 'demo';
      }), false);
      assert.equal(parsed.servers.some(function hasAux(entry) {
        return entry.name === 'aux';
      }), true);
      const aux = parsed.servers.find(function findAux(entry) {
        return entry.name === 'aux';
      });
      assert.deepEqual(aux?.config, { command: 'codex-aux' });
    });

    it('retains vscode inputs metadata on removal', async function vscodeRemoveInputsCase() {
      const workspace = await tempdir('vscode-remove-');
      const dir = path.join(workspace, '.vscode');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, 'mcp.json');
      await fs.copyFile(fixture('vscode/project/.vscode/mcp.json'), file);

      const config = await load(undefined, workspace);
      await config.add({ name: 'extra', config: { type: 'http', url: 'https://example.test/extra' } }, { connector: 'vscode', file });

      await config.remove('store');

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.equal(Object.hasOwn(doc.servers, 'store'), false);
      assert.deepEqual(doc.servers.extra, { type: 'http', url: 'https://example.test/extra' });
      assert.deepEqual(doc.inputs, [
        { id: 'token', type: 'promptString', description: 'API token', password: true }
      ]);
    });

    it('keeps cline metadata intact on removal', async function clineRemoveMetadataCase() {
      const homeDir = await tempdir('cline-remove-');
      const file = path.join(homeDir, 'cline_mcp_settings.json');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.copyFile(
        fixture('cline/home/Library/Application Support/Code/User/globalStorage/cline.bot-cline/cline_mcp_settings.json'),
        file
      );

      const base = JSON.parse(await fs.readFile(file, 'utf8'));
      base.autoApprove = ['tools'];
      await fs.writeFile(file, `${JSON.stringify(base, null, 2)}\n`, 'utf8');

      const env = { CLINE_MCP_SETTINGS_PATH: file };
      const config = await load(undefined, { start: fixture('cline/home'), homeDir, env, platform: 'darwin' });
      await config.add({ name: 'aux', config: { command: 'aux' } }, { connector: 'cline', file });

      await config.remove('sample');

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.equal(Object.hasOwn(doc.mcpServers, 'sample'), false);
      assert.deepEqual(doc.mcpServers.aux, { command: 'aux' });
      assert.equal(doc.defaultMode, 'all');
      assert.deepEqual(doc.autoApprove, ['tools']);
    });

    it('throws when connector is missing during add', async function addMissingConnectorCase() {
      const config = new Config();
      config.registerServer('ghost', { command: 'ghost' }, '/tmp/ghost.json', 'unknown', true);
      await assert.rejects(config.add({ name: 'ghost', config: { command: 'ghost' } }), /Connector "unknown" does not support write operations/);
    });

    it('requires file path when adding new server', async function addMissingFileCase() {
      const config = new Config();
      await assert.rejects(config.add({ name: 'demo', config: { command: 'demo' } }, { connector: 'claude-code' }), /File path is required/);
    });

    it('throws when connector lacks writer during removal', async function removeMissingConnectorCase() {
      const config = new Config();
      config.registerServer('ghost', { command: 'ghost' }, '/tmp/ghost.json', 'unknown', true);
      await assert.rejects(config.remove('ghost'), /Connector "unknown" does not support write operations/);
    });

    it('adds servers into new files when provided with connector and file', async function addCreatesListEntryCase() {
      const dir = await tempdir('config-add-new-');
      const file = path.join(dir, '.mcp.json');
      const config = new Config();

      await config.add({ name: 'direct', config: { command: 'direct' } }, { connector: 'claude-code', file });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.direct, { command: 'direct' });
      assert.equal(config.list.some(function hasPath(entry) {
        return entry.path === file;
      }), true);
    });

    it('ignores removal requests when the server is missing from the map', async function removeMissingServerCase() {
      const config = new Config();
      await config.remove('absent');
    });

    it('skips rewriting when the remaining list matches original servers', async function removeNoopCase() {
      const dir = await tempdir('config-remove-noop-');
      const file = path.join(dir, '.mcp.json');
      await fs.copyFile(fixture('claude/project/.mcp.json'), file);

      const config = new Config();
      config.registerServer('ghost', { command: 'ghost' }, file, 'claude-code', true);

      await config.remove('ghost');

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers, { demo: { command: 'demo' } });
    });
  });
});
