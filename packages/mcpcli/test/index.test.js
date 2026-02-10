import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const base = path.join(fixtures, 'config.json');
const bin = fileURLToPath(new URL('../src/bin.js', import.meta.url));
const read = createRequire(import.meta.url);
const pkg = read('../package.json');
const serverpkg = read.resolve('@mcp-layer/test-server/package.json');
const entry = path.join(path.dirname(serverpkg), 'src', 'bin.js');
const exec = promisify(execFile);

/**
 * Create a temporary directory for CLI tests.
 * @returns {Promise<string>}
 */
async function tempdir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'mcp-layer-mcpcli-'));
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
 * Run a CLI binary and capture stdout/stderr.
 * @param {string[]} args - CLI arguments to pass to the test process.
 * @param {{ cwd?: string }} [options] - Spawn options for working directory.
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runcli(args, options = {}) {
  try {
    return await exec(process.execPath, [bin, ...args], {
      cwd: options.cwd,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      maxBuffer: 10 * 1024 * 1024
    });
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    throw new Error(stderr || `CLI exited with ${error?.code ?? 'unknown'}`);
  }
}

/**
 * Validate version output for the dedicated CLI package.
 * @returns {Promise<void>}
 */
async function versionCase() {
  const result = await runcli(['--version']);
  assert.equal(result.stdout.trim(), `mcpcli ${pkg.version}`);
}

/**
 * Run the version suite.
 * @returns {void}
 */
function versionSuite() {
  it('prints CLI version metadata', versionCase);
}

/**
 * Validate help output uses the standalone command name.
 * @returns {Promise<void>}
 */
async function helpCase() {
  const result = await runcli(['--help']);
  assert.equal(result.stdout.includes('mcpcli <command>'), true);
}

/**
 * Run the help suite.
 * @returns {void}
 */
function helpSuite() {
  it('renders help with the mcpcli command name', helpCase);
}

/**
 * Validate server listings from a discovered MCP config.
 * @returns {Promise<void>}
 */
async function serversCase() {
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
  it('lists servers from discovered config', serversCase);
}

/**
 * Run the mcpcli suite.
 * @returns {void}
 */
function suite() {
  describe('version', versionSuite);
  describe('help', helpSuite);
  describe('servers', serversSuite);
}

describe('mcpcli', suite);
