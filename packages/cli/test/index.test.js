import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const base = path.join(fixtures, 'config.json');
const cli = fileURLToPath(new URL('../bin/cli.js', import.meta.url));
const custom = fileURLToPath(new URL('./fixtures/custom-cli.mjs', import.meta.url));
const read = createRequire(import.meta.url);
const serverpkg = read.resolve('@mcp-layer/test-server/package.json');
const entry = path.join(path.dirname(serverpkg), 'src', 'bin.js');

/**
 * Create a temporary directory for CLI tests.
 * @returns {Promise<string>}
 */
async function tempdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mcp-layer-cli-'));
}

/**
 * Copy the base config fixture into a temp directory.
 * @param {string} dir - Temporary directory to receive the config file.
 * @returns {Promise<string>}
 */
async function copyconfig(dir) {
  const file = path.join(dir, 'mcp.json');
  await fs.copyFile(base, file);
  return file;
}

/**
 * Inject runtime command details into the config file.
 * @param {string} file - Path to the config file to update.
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
 * Run the CLI and capture stdout/stderr.
 * @param {string[]} args - CLI arguments to pass to the test process.
 * @param {{ cwd?: string }} [options] - Spawn options for working directory.
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runcli(args, options = {}) {
  return new Promise(function executor(resolve, reject) {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: options.cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    });

    let stdout = '';
    let stderr = '';

    /**
     * Collect stdout chunks.
     * @param {Buffer} chunk - Buffer chunk read from stdout.
     * @returns {void}
     */
    function onStdout(chunk) {
      stdout += chunk.toString();
    }

    /**
     * Collect stderr chunks.
     * @param {Buffer} chunk - Buffer chunk read from stderr.
     * @returns {void}
     */
    function onStderr(chunk) {
      stderr += chunk.toString();
    }

    /**
     * Handle child process errors.
     * @param {Error} error - Spawn error to surface in the test.
     * @returns {void}
     */
    function onError(error) {
      reject(error);
    }

    /**
     * Handle child process exit.
     * @param {number | null} code - Exit code from the child process.
     * @returns {void}
     */
    function onClose(code) {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `CLI exited with ${code}`));
    }

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('error', onError);
    child.on('close', onClose);
  });
}

/**
 * Run the custom CLI fixture and capture stdout/stderr.
 * @param {string[]} args - CLI arguments to pass to the custom fixture.
 * @param {{ cwd?: string }} [options] - Spawn options for working directory.
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runcustom(args, options = {}) {
  return new Promise(function executor(resolve, reject) {
    const child = spawn(process.execPath, [custom, ...args], {
      cwd: options.cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    });

    let stdout = '';
    let stderr = '';

    /**
     * Collect stdout chunks.
     * @param {Buffer} chunk - Buffer chunk read from stdout.
     * @returns {void}
     */
    function onStdout(chunk) {
      stdout += chunk.toString();
    }

    /**
     * Collect stderr chunks.
     * @param {Buffer} chunk - Buffer chunk read from stderr.
     * @returns {void}
     */
    function onStderr(chunk) {
      stderr += chunk.toString();
    }

    /**
     * Handle child process errors.
     * @param {Error} error - Spawn error to surface in the test.
     * @returns {void}
     */
    function onError(error) {
      reject(error);
    }

    /**
     * Handle child process exit.
     * @param {number | null} code - Exit code from the child process.
     * @returns {void}
     */
    function onClose(code) {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(stderr || `CLI exited with ${code}`));
    }

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.on('error', onError);
    child.on('close', onClose);
  });
}

/**
 * Prepare a temporary config for CLI tests.
 * @returns {Promise<{ dir: string, file: string }>}
 */
async function setupconfig() {
  const dir = await tempdir();
  const file = await copyconfig(dir);
  await hydrateconfig(file);
  return { dir, file };
}

/**
 * Parse JSON output from the CLI.
 * @param {string} output - Raw CLI stdout to parse.
 * @returns {unknown}
 */
function parsejson(output) {
  return JSON.parse(output.trim());
}

/**
 * Validate the CLI server listing output.
 * @returns {Promise<void>}
 */
async function serversListCase() {
  const setup = await setupconfig();
  const result = await runcli(['servers', 'list', '--config', setup.file, '--format', 'json']);
  const data = parsejson(result.stdout);

  assert.equal(Array.isArray(data), true);
  assert.equal(data[0].name, 'demo');
  assert.equal(data[0].source, setup.file);
}

/**
 * Run the server listing suite.
 * @returns {void}
 */
function serversSuite() {
  it('prints configured servers as JSON', serversListCase);
}

/**
 * Validate tool listings against the test server.
 * @returns {Promise<void>}
 */
async function toolsListCase() {
  const setup = await setupconfig();
  const result = await runcli(['tools', 'list', '--config', setup.file, '--format', 'json']);
  const data = parsejson(result.stdout);
  const names = data.filter(function onlyTools(item) {
    return item.type === 'tool';
  }).map(function mapName(item) {
    return item.name;
  });

  assert.equal(names.includes('echo'), true);
}

/**
 * Run the tool list suite.
 * @returns {void}
 */
function toolsSuite() {
  it('lists tools from the MCP server', toolsListCase);
}

/**
 * Validate tool execution against the test server.
 * @returns {Promise<void>}
 */
async function toolsRunCase() {
  const setup = await setupconfig();
  const result = await runcli(['tools', 'echo', '--config', setup.file, '--text', 'hello', '--raw']);
  const data = parsejson(result.stdout);

  assert.equal(Array.isArray(data.content), true);
  assert.equal(data.content[0].text, 'hello');
}

/**
 * Run the tool execution suite.
 * @returns {void}
 */
function toolsRunSuite() {
  it('executes a tool and returns JSON output', toolsRunCase);
}

/**
 * Validate numeric coercion for scalar inputs.
 * @returns {Promise<void>}
 */
async function toolsAddCase() {
  const setup = await setupconfig();
  const result = await runcli(['tools', 'add', '--config', setup.file, '--first', '2', '--second', '5', '--raw']);
  const data = parsejson(result.stdout);

  assert.equal(data.structuredContent.total, 7);
}

/**
 * Run numeric coercion suite.
 * @returns {void}
 */
function toolsAddSuite() {
  it('coerces numeric inputs for tool execution', toolsAddCase);
}

/**
 * Validate array/object inputs are parsed as JSON.
 * @returns {Promise<void>}
 */
async function toolsArrayCase() {
  const setup = await setupconfig();
  const result = await runcli([
    'tools',
    'batch',
    '--config',
    setup.file,
    '--items',
    '["one","two"]',
    '--meta',
    '{\"tag\":\"alpha\"}',
    '--raw'
  ]);
  const data = parsejson(result.stdout);

  assert.equal(data.structuredContent.tag, 'alpha');
  assert.equal(data.structuredContent.count, 2);
}

/**
 * Run array/object input suite.
 * @returns {void}
 */
function toolsArraySuite() {
  it('parses array and object inputs from JSON', toolsArrayCase);
}

/**
 * Validate object input via dot notation.
 * @returns {Promise<void>}
 */
async function toolsDotCase() {
  const setup = await setupconfig();
  const result = await runcli([
    'tools',
    'batch',
    '--config',
    setup.file,
    '--items',
    '["one","two"]',
    '--meta.tag',
    'alpha',
    '--raw'
  ]);
  const data = parsejson(result.stdout);

  assert.equal(data.structuredContent.tag, 'alpha');
  assert.equal(data.structuredContent.count, 2);
}

/**
 * Run dot-notation input suite.
 * @returns {void}
 */
function toolsDotSuite() {
  it('parses object inputs from dot-notation flags', toolsDotCase);
}

/**
 * Validate help output includes discovered servers.
 * @returns {Promise<void>}
 */
async function helpCase() {
  const setup = await setupconfig();
  const result = await runcli(['--help', '--config', setup.file, '--server', 'demo']);

  assert.equal(result.stdout.includes('Servers'), true);
  assert.equal(result.stdout.includes('demo'), true);
  assert.equal(result.stdout.includes('Tools'), true);
  assert.equal(result.stdout.includes('tools echo'), true);
  assert.equal(result.stdout.includes('--text'), true);
  assert.equal(result.stdout.includes('--text (string) (required)'), true);
  assert.equal(result.stdout.includes('Example:'), true);
  assert.equal(result.stdout.includes('tools echo --server demo'), true);
  assert.equal(result.stdout.includes('CLI v'), true);
}

/**
 * Run the help output suite.
 * @returns {void}
 */
function helpSuite() {
  it('lists discovered servers in help output', helpCase);
}

/**
 * Validate CLI name usage in help output.
 * @returns {Promise<void>}
 */
async function customNameCase() {
  const result = await runcustom(['--help']);

  assert.equal(result.stdout.includes('mcp-demo <command>'), true);
}

/**
 * Validate custom command help output.
 * @returns {Promise<void>}
 */
async function customHelpCase() {
  const result = await runcustom(['mcp', '--help']);

  assert.equal(result.stdout.includes('mcp'), true);
  assert.equal(result.stdout.includes('--spec'), true);
  assert.equal(result.stdout.includes('Examples'), true);
  assert.equal(result.stdout.includes('mcp-demo mcp'), true);
}

/**
 * Run custom command help suite.
 * @returns {void}
 */
function customHelpSuite() {
  it('uses the CLI name in help output', customNameCase);
  it('renders custom command help output', customHelpCase);
}

/**
 * Validate per-command help output for tools.
 * @returns {Promise<void>}
 */
async function toolHelpCase() {
  const setup = await setupconfig();
  const result = await runcli(['tools', 'echo', '--help', '--config', setup.file, '--server', 'demo']);

  assert.equal(result.stdout.includes('echo'), true);
  assert.equal(result.stdout.includes('--text'), true);
  assert.equal(result.stdout.includes('Example:'), true);
}

/**
 * Validate per-command help output for object/array input syntax.
 * @returns {Promise<void>}
 */
async function toolHelpInputCase() {
  const setup = await setupconfig();
  const result = await runcli(['tools', 'batch', '--help', '--config', setup.file, '--server', 'demo']);

  assert.equal(result.stdout.includes('Input syntax'), true);
  assert.equal(result.stdout.includes('--meta.key'), true);
  assert.equal(result.stdout.includes('--meta \'{"key":"value"}\''), true);
  assert.equal(result.stdout.includes('--items <value> --items <value>'), true);
}

/**
 * Run the tool help suite.
 * @returns {void}
 */
function toolHelpSuite() {
  it('shows detailed tool help', toolHelpCase);
  it('describes object and array input syntax', toolHelpInputCase);
}

/**
 * Validate formatted output for mixed content types.
 * @returns {Promise<void>}
 */
async function toolsPresentCase() {
  const setup = await setupconfig();
  const result = await runcli(['tools', 'present', '--config', setup.file, '--title', 'Demo']);

  assert.equal(result.stdout.includes('Image:'), true);
  assert.equal(result.stdout.includes('Audio:'), true);
  assert.equal(result.stdout.includes('Resource link'), true);
  assert.equal(result.stdout.includes('Embedded resource'), true);
}

/**
 * Run the tool formatting suite.
 * @returns {void}
 */
function toolsPresentSuite() {
  it('formats mixed content outputs', toolsPresentCase);
}

/**
 * Validate raw resource output returns plain content.
 * @returns {Promise<void>}
 */
async function resourceRawCase() {
  const setup = await setupconfig();
  const result = await runcli(['resources', 'resource://manual', '--config', setup.file, '--raw']);

  assert.equal(result.stdout.includes('# MCP Test Server Manual'), true);
  assert.equal(result.stdout.trim().startsWith('{'), false);
}

/**
 * Run resource output suite.
 * @returns {void}
 */
function resourceSuite() {
  it('emits raw text for single resource payloads', resourceRawCase);
}

/**
 * Run the CLI test suite.
 * @returns {void}
 */
function cliSuite() {
  describe('servers list', serversSuite);
  describe('tools list', toolsSuite);
  describe('tools exec', toolsRunSuite);
  describe('tools numeric coercion', toolsAddSuite);
  describe('tools arrays', toolsArraySuite);
  describe('tools dot notation', toolsDotSuite);
  describe('help output', helpSuite);
  describe('tool help', toolHelpSuite);
  describe('tools formatting', toolsPresentSuite);
  describe('custom help', customHelpSuite);
  describe('resource raw output', resourceSuite);
}

describe('cli', cliSuite);
