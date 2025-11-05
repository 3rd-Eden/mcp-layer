import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeCode } from '../src/connectors/claude-code.js';
import { cursor } from '../src/connectors/cursor.js';
import { codex } from '../src/connectors/codex.js';
import { vscode } from '../src/connectors/vscode.js';
import { cline } from '../src/connectors/cline.js';
import { collectCandidates } from '../src/connectors/index.js';

const fixturesRoot = fileURLToPath(new URL('./fixtures/', import.meta.url));
const fixture = (...segments) => path.join(fixturesRoot, ...segments);
const tempdir = (prefix) => fs.mkdtemp(path.join(os.tmpdir(), prefix));

describe('connectors', function connectorsSuite() {
  describe('claude', function claudeSuite() {
    it('points at project .mcp.json', function claudeProjectCase() {
      const dir = fixture('claude/project');
      const list = claudeCode.project(dir);
      assert.equal(list.includes(path.join(dir, '.mcp.json')), true);
    });

    it('reflects documented home level locations', function claudeGlobalCase() {
      const homeDir = fixture('claude/home');
      const ctx = { home: homeDir, env: { MCP_CONFIG_PATH: '~/override.json' }, platform: 'darwin' };
      const list = claudeCode.home(ctx);
      assert.equal(list.includes(path.join(homeDir, 'override.json')), true);
      assert.equal(list.includes(path.join('/Library', 'Application Support', 'ClaudeCode', 'managed-mcp.json')), true);
      assert.equal(list.includes(path.join(homeDir, '.mcp.json')), true);
    });

    it('includes enterprise windows path', function claudeWindowsCase() {
      const ctx = { home: 'C:/Users/dev', env: {}, platform: 'win32' };
      const list = claudeCode.home(ctx);
      assert.equal(list.includes('C:/ProgramData/ClaudeCode/managed-mcp.json'), true);
    });

    it('parses mcpServers payload', async function claudeParseCase() {
      const raw = await fs.readFile(fixture('claude/project/.mcp.json'), 'utf8');
      const result = claudeCode.parse(raw, fixture('claude/project/.mcp.json'));
      assert.deepEqual(result, { servers: [{ name: 'demo', config: { command: 'demo' } }], metadata: {} });
    });

    it('returns empty list when config lacks servers', function claudeMissingServersCase() {
      const result = claudeCode.parse('{}', '/tmp/empty.json');
      assert.deepEqual(result, { servers: [], metadata: {} });
    });

    it('throws on invalid json', function claudeInvalidJsonCase() {
      assert.throws(function badJson() {
        claudeCode.parse('{ invalid', '/tmp/bad.json');
      }, /Failed to parse JSON/);
    });

    it('ignores non-object server entries', function claudeIgnoreInvalidCase() {
      const result = claudeCode.parse(JSON.stringify({ mcpServers: { demo: null, ok: { command: 'ok' } } }), '/tmp/diff.json');
      assert.deepEqual(result, { servers: [{ name: 'ok', config: { command: 'ok' } }], metadata: {} });
    });

    it('writes new server entries', async function claudeWriteCase() {
      const dir = await tempdir('claude-write-');
      const file = path.join(dir, '.mcp.json');
      await fs.copyFile(fixture('claude/project/.mcp.json'), file);
      await claudeCode.write(file, { name: 'new', config: { command: 'new' } });
      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.new, { command: 'new' });
      assert.deepEqual(doc.mcpServers.demo, { command: 'demo' });
    });

    it('creates claude config when missing', async function claudeCreateCase() {
      const dir = await tempdir('claude-create-');
      const file = path.join(dir, '.mcp.json');
      await claudeCode.write(file, { name: 'fresh', config: { command: 'fresh' } });
      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.fresh, { command: 'fresh' });
    });

    it('rebuilds claude config from metadata when existing document is invalid', async function claudeRewriteCase() {
      const dir = await tempdir('claude-rewrite-');
      const file = path.join(dir, '.mcp.json');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, 'null', 'utf8');

      await claudeCode.write(file, null, { servers: [{ name: 'restore', config: { command: 'restore' } }] });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.restore, { command: 'restore' });
    });

    it('recovers claude config when existing JSON is malformed', async function claudeMalformedCase() {
      const dir = await tempdir('claude-malformed-');
      const file = path.join(dir, '.mcp.json');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, '{', 'utf8');

      await claudeCode.write(file, { name: 'new', config: { command: 'new' } });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.new, { command: 'new' });
    });
  });

  describe('cursor', function cursorSuite() {
    it('prefers project cursor directory', function cursorProjectCase() {
      const dir = fixture('cursor/project');
      const list = cursor.project(dir);
      assert.equal(list.includes(path.join(dir, '.cursor', 'mcp.json')), true);
    });

    it('loads user scoped cursor config', function cursorGlobalCase() {
      const homeDir = fixture('cursor/home');
      const list = cursor.home({ home: homeDir, env: {}, platform: 'linux' });
      assert.equal(list.includes(path.join(homeDir, '.cursor', 'mcp.json')), true);
    });

    it('returns empty list when cursor home missing', function cursorNoHomeCase() {
      const list = cursor.home({ home: undefined, env: {}, platform: 'linux' });
      assert.equal(Array.isArray(list), true);
      assert.equal(list.length, 0);
    });

    it('parses cursor mcpServers payload', async function cursorParseCase() {
      const raw = await fs.readFile(fixture('cursor/project/.cursor/mcp.json'), 'utf8');
      const result = cursor.parse(raw, fixture('cursor/project/.cursor/mcp.json'));
      assert.deepEqual(result, { servers: [{ name: 'demo', config: { command: 'cursor' } }], metadata: {} });
    });

    it('returns empty list when cursor config lacks servers', function cursorMissingServersCase() {
      const result = cursor.parse('{}', '/tmp/empty.json');
      assert.deepEqual(result, { servers: [], metadata: {} });
    });

    it('throws on invalid json', function cursorInvalidJsonCase() {
      assert.throws(function badCursorJson() {
        cursor.parse('{ nope', '/tmp/bad.json');
      }, /Failed to parse JSON/);
    });

    it('ignores non-object cursor servers', function cursorIgnoreInvalidCase() {
      const result = cursor.parse(JSON.stringify({ mcpServers: { demo: 42, ok: { command: 'ok' } } }), '/tmp/demo.json');
      assert.deepEqual(result, { servers: [{ name: 'ok', config: { command: 'ok' } }], metadata: {} });
    });

    it('writes cursor server entries', async function cursorWriteCase() {
      const dir = await tempdir('cursor-write-');
      const file = path.join(dir, '.cursor', 'mcp.json');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.copyFile(fixture('cursor/project/.cursor/mcp.json'), file);
      await cursor.write(file, { name: 'new', config: { command: 'new' } });
      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.new, { command: 'new' });
      assert.deepEqual(doc.mcpServers.demo, { command: 'cursor' });
    });

    it('rebuilds cursor config from metadata when existing document is invalid', async function cursorRewriteCase() {
      const dir = await tempdir('cursor-rewrite-');
      const file = path.join(dir, '.cursor', 'mcp.json');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'null', 'utf8');

      await cursor.write(file, null, { servers: [{ name: 'restore', config: { command: 'restore' } }] });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.restore, { command: 'restore' });
    });

    it('recovers cursor config when existing JSON is malformed', async function cursorMalformedCase() {
      const dir = await tempdir('cursor-malformed-');
      const file = path.join(dir, '.cursor', 'mcp.json');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '{', 'utf8');

      await cursor.write(file, { name: 'new', config: { command: 'new' } });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.new, { command: 'new' });
    });
  });

  describe('codex', function codexSuite() {
    it('omits project search because Codex only uses user config', function codexProjectCase() {
      const list = codex.project(fixture('codex/workspace'));
      assert.equal(Array.isArray(list), true);
      assert.equal(list.length, 0);
    });

    it('returns codex config.toml from CODEX_HOME', function codexGlobalCase() {
      const ctx = { home: '/Users/dev', env: { CODEX_HOME: '/opt/codex' }, platform: 'darwin' };
      const list = codex.home(ctx);
      assert.equal(list.includes(path.join('/opt/codex', 'config.toml')), true);
    });

    it('returns empty list when codex directories missing', function codexHomeFallbackCase() {
      const list = codex.home({ home: undefined, env: {}, platform: 'darwin' });
      assert.equal(Array.isArray(list), true);
      assert.equal(list.length, 0);
    });

    it('parses codex toml payload', async function codexParseCase() {
      const raw = await fs.readFile(fixture('codex/home/.codex/config.toml'), 'utf8');
      const result = codex.parse(raw, fixture('codex/home/.codex/config.toml'));
      assert.deepEqual(result, { servers: [{ name: 'demo', config: { command: 'codex', args: ['--flag'], env: { TOKEN: 'secret' } } }], metadata: {} });
    });

    it('returns empty list when codex config lacks servers', function codexMissingServersCase() {
      const result = codex.parse('', '/tmp/empty.toml');
      assert.deepEqual(result, { servers: [], metadata: {} });
    });

    it('throws on invalid toml', function codexInvalidTomlCase() {
      assert.throws(function badToml() {
        codex.parse('not=toml', '/tmp/bad.toml');
      });
    });

    it('ignores non-object codex servers', function codexIgnoreInvalidCase() {
      const raw = `
[mcp_servers]
invalid = 123

[mcp_servers.valid]
command = "codex"
`;
      const result = codex.parse(raw, '/tmp/mixed.toml');
      assert.deepEqual(result, { servers: [{ name: 'valid', config: { command: 'codex' } }], metadata: {} });
    });

    it('writes codex server entries', async function codexWriteCase() {
      const dir = await tempdir('codex-write-');
      const file = path.join(dir, 'config.toml');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.copyFile(fixture('codex/home/.codex/config.toml'), file);
      await codex.write(file, { name: 'new', config: { command: 'codex-new' } });
      const parsed = codex.parse(await fs.readFile(file, 'utf8'), file);
      const names = parsed.servers.map((entry) => entry.name);
      assert.equal(names.includes('new'), true);
      const newEntry = parsed.servers.find((entry) => entry.name === 'new');
      assert.deepEqual(newEntry?.config, { command: 'codex-new' });
    });

    it('rewrites codex metadata when restoring from servers array', async function codexRewriteCase() {
      const dir = await tempdir('codex-rewrite-');
      const file = path.join(dir, 'config.toml');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'mcp_servers = "invalid"\n', 'utf8');

      await codex.write(file, null, { servers: [{ name: 'restore', config: { command: 'codex-restore' } }] });

      const parsed = codex.parse(await fs.readFile(file, 'utf8'), file);
      assert.deepEqual(parsed.servers, [{ name: 'restore', config: { command: 'codex-restore' } }]);
    });

    it('recovers codex config when existing TOML is malformed', async function codexMalformedCase() {
      const dir = await tempdir('codex-malformed-');
      const file = path.join(dir, 'config.toml');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'not=toml', 'utf8');

      await codex.write(file, { name: 'new', config: { command: 'codex-new' } });

      const parsed = codex.parse(await fs.readFile(file, 'utf8'), file);
      assert.deepEqual(parsed.servers, [{ name: 'new', config: { command: 'codex-new' } }]);
    });
  });

  describe('vscode', function vscodeSuite() {
    it('discovers workspace and user config files', function vscodePathsCase() {
      const dir = fixture('vscode/project');
      const project = vscode.project(dir);
      const homePaths = vscode.home({ home: fixture('vscode/home') });
      assert.equal(project.includes(path.join(dir, '.vscode', 'mcp.json')), true);
      assert.equal(project.includes(path.join(dir, 'mcp.json')), true);
      assert.equal(homePaths.includes(path.join(fixture('vscode/home'), '.vscode', 'mcp.json')), true);
    });

    it('returns empty list when vscode home missing', function vscodeNoHomeCase() {
      const list = vscode.home({ home: undefined });
      assert.equal(Array.isArray(list), true);
      assert.equal(list.length, 0);
    });

    it('parses servers and exposes inputs metadata', async function vscodeParseCase() {
      const raw = await fs.readFile(fixture('vscode/project/.vscode/mcp.json'), 'utf8');
      const result = vscode.parse(raw, fixture('vscode/project/.vscode/mcp.json'));
      assert.deepEqual(result, {
        servers: [{ name: 'store', config: { type: 'http', url: 'https://example.test/mcp' } }],
        metadata: {
          inputs: [
            { id: 'token', type: 'promptString', description: 'API token', password: true }
          ]
        }
      });
    });

    it('returns inputs metadata when no servers defined', function vscodeInputsOnlyCase() {
      const result = vscode.parse(JSON.stringify({ inputs: [{ id: 'token', type: 'promptString' }] }), '/tmp/inputs.json');
      assert.deepEqual(result, { servers: [], metadata: { inputs: [{ id: 'token', type: 'promptString' }] } });
    });

    it('throws on invalid json for vscode', function vscodeInvalidJsonCase() {
      assert.throws(function badVSJson() {
        vscode.parse('{ nope', '/tmp/bad.json');
      }, /Failed to parse JSON/);
    });

    it('writes vscode server entries with metadata', async function vscodeWriteCase() {
      const dir = await tempdir('vscode-write-');
      const file = path.join(dir, '.vscode', 'mcp.json');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.copyFile(fixture('vscode/project/.vscode/mcp.json'), file);
      await vscode.write(file, { name: 'new', config: { type: 'stdio', command: 'new' } }, { inputs: [{ id: 'token' }] });
      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.servers.new, { type: 'stdio', command: 'new' });
      assert.deepEqual(doc.inputs, [{ id: 'token' }]);
    });

    it('skips non-object vscode servers during parse', function vscodeSkipInvalidCase() {
      const raw = JSON.stringify({ servers: { broken: false, valid: { type: 'stdio', command: 'ok' } } });
      const parsed = vscode.parse(raw, '/tmp/vscode.json');
      assert.deepEqual(parsed.servers, [{ name: 'valid', config: { type: 'stdio', command: 'ok' } }]);
    });

    it('rebuilds vscode config from metadata when existing document is invalid', async function vscodeRewriteCase() {
      const dir = await tempdir('vscode-rewrite-');
      const file = path.join(dir, '.vscode', 'mcp.json');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, 'null', 'utf8');

      await vscode.write(file, null, {
        servers: [{ name: 'restore', config: { type: 'http', url: 'https://example.test/restore' } }],
        inputs: [{ id: 'token', type: 'promptString' }]
      });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.servers.restore, { type: 'http', url: 'https://example.test/restore' });
      assert.deepEqual(doc.inputs, [{ id: 'token', type: 'promptString' }]);
    });

    it('recovers vscode config when existing JSON is malformed', async function vscodeMalformedCase() {
      const dir = await tempdir('vscode-malformed-');
      const file = path.join(dir, '.vscode', 'mcp.json');
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, '{', 'utf8');

      await vscode.write(file, { name: 'new', config: { type: 'stdio', command: 'new' } });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.servers.new, { type: 'stdio', command: 'new' });
    });
  });

  describe('cline', function clineSuite() {
    it('locates settings across supported platforms', function clinePathsCase() {
      const homeDir = fixture('cline/home');
      const darwin = cline.home({ home: homeDir, env: {}, platform: 'darwin' });
      assert.equal(darwin.includes(path.join(homeDir, 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'cline.bot-cline', 'cline_mcp_settings.json')), true);

      const appData = 'C:/Users/dev/AppData/Roaming';
      const win = cline.home({ home: 'C:/Users/dev', env: { APPDATA: appData }, platform: 'win32' });
      assert.equal(win.includes(path.join(appData, 'Code', 'User', 'globalStorage', 'cline.bot-cline', 'cline_mcp_settings.json')), true);

      const xdg = '/home/dev/.config';
      const linux = cline.home({ home: '/home/dev', env: { XDG_CONFIG_HOME: xdg }, platform: 'linux' });
      assert.equal(linux.includes(path.join(xdg, 'Code', 'User', 'globalStorage', 'cline.bot-cline', 'cline_mcp_settings.json')), true);
    });

    it('honours explicit settings path', function clineCustomPathCase() {
      const homeDir = fixture('cline/home');
      const list = cline.home({ home: homeDir, env: { CLINE_MCP_SETTINGS_PATH: '~/custom/settings.json' }, platform: 'darwin' });
      assert.equal(list.includes(path.join(homeDir, 'custom', 'settings.json')), true);
    });

    it('parses cline mcpServers payload', async function clineParseCase() {
      const raw = await fs.readFile(fixture('cline/home/Library/Application Support/Code/User/globalStorage/cline.bot-cline/cline_mcp_settings.json'), 'utf8');
      const result = cline.parse(raw, fixture('cline/home/Library/Application Support/Code/User/globalStorage/cline.bot-cline/cline_mcp_settings.json'));
      assert.deepEqual(result, {
        servers: [{ name: 'sample', config: { command: 'cline', disabled: false } }],
        metadata: { defaultMode: 'all' }
      });
    });

    it('returns empty metadata when cline config lacks extras', function clineNoExtrasCase() {
      const result = cline.parse(JSON.stringify({ mcpServers: { demo: { command: 'cline' } } }), '/tmp/basic.json');
      assert.deepEqual(result, { servers: [{ name: 'demo', config: { command: 'cline' } }], metadata: {} });
    });

    it('throws on invalid json for cline', function clineInvalidJsonCase() {
      assert.throws(function badClineJson() {
        cline.parse('{ nope', '/tmp/bad.json');
      }, /Failed to parse JSON/);
    });

    it('returns empty when cline config missing servers entirely', function clineMissingServersCase() {
      const result = cline.parse('{}', '/tmp/empty.json');
      assert.deepEqual(result, { servers: [], metadata: {} });
    });

    it('captures cline auto-approve metadata', function clineAutoApproveCase() {
      const result = cline.parse(JSON.stringify({ mcpServers: { demo: { command: 'cline' } }, autoApprove: ['tool'], defaultMode: 'custom' }), '/tmp/extra.json');
      assert.deepEqual(result, {
        servers: [{ name: 'demo', config: { command: 'cline' } }],
        metadata: { autoApprove: ['tool'], defaultMode: 'custom' }
      });
    });

    it('ignores non-object cline servers', function clineIgnoreInvalidCase() {
      const result = cline.parse(JSON.stringify({ mcpServers: { bad: false, ok: { command: 'ok' } } }), '/tmp/bad.json');
      assert.deepEqual(result, { servers: [{ name: 'ok', config: { command: 'ok' } }], metadata: {} });
    });

    it('writes cline server entries with metadata', async function clineWriteCase() {
      const dir = await tempdir('cline-write-');
      const file = path.join(dir, 'cline_mcp_settings.json');
      await fs.copyFile(fixture('cline/home', 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'cline.bot-cline', 'cline_mcp_settings.json'), file);
      await cline.write(file, { name: 'new', config: { command: 'new' } }, { defaultMode: 'custom' });
      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.new, { command: 'new' });
      assert.equal(doc.defaultMode, 'custom');
    });

    it('rebuilds cline settings from metadata when existing document is invalid', async function clineRewriteCase() {
      const dir = await tempdir('cline-rewrite-');
      const file = path.join(dir, 'cline_mcp_settings.json');
      await fs.writeFile(file, 'null', 'utf8');

      await cline.write(file, null, {
        servers: [{ name: 'restore', config: { command: 'restore' } }],
        defaultMode: 'all',
        autoApprove: ['tools']
      });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.restore, { command: 'restore' });
      assert.equal(doc.defaultMode, 'all');
      assert.deepEqual(doc.autoApprove, ['tools']);
    });

    it('recovers cline settings when existing JSON is malformed', async function clineMalformedCase() {
      const dir = await tempdir('cline-malformed-');
      const file = path.join(dir, 'cline_mcp_settings.json');
      await fs.writeFile(file, '{', 'utf8');

      await cline.write(file, { name: 'new', config: { command: 'new' } });

      const doc = JSON.parse(await fs.readFile(file, 'utf8'));
      assert.deepEqual(doc.mcpServers.new, { command: 'new' });
    });
  });

  describe('collectCandidates', function aggregateSuite() {
    it('includes expected connectors in priority order', function aggregateOrderCase() {
      const ctx = {
        cwd: fixture('claude/project'),
        home: fixture('cline/home'),
        env: {
          MCP_CONFIG_PATH: fixture('claude/override.json'),
          CLINE_MCP_SETTINGS_PATH: fixture('cline/home/custom/settings.json')
        },
        platform: 'darwin'
      };
      const list = collectCandidates(ctx);
      assert.equal(list.length > 0, true);
      assert.equal(list[0].source.connector, 'claude-code');
      assert.equal(list.some(function findVSCode(entry) {
        return entry.source.connector === 'vscode';
      }), true);
      assert.equal(list.some(function findCline(entry) {
        return entry.source.connector === 'cline';
      }), true);
    });
  });
});
