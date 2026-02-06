import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashtag } from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const PACKAGES = ['attach', 'cli', 'config', 'connect', 'manager', 'openapi', 'rest', 'schema', 'test-server'];

/**
 * Parse literal string values from `new LayerError` calls.
 * @param {string} source - File source.
 * @returns {Array<{ name: string, method: string, message: string }>}
 */
function extractLayerErrors(source) {
  const list = [];
  const re = /new\s+LayerError\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  let match = re.exec(source);

  while (match) {
    const body = match[1] ?? '';
    const name = pick(body, 'name');
    const method = pick(body, 'method');
    const message = pick(body, 'message');

    if (name && method && message) {
      list.push({ name, method, message });
    }

    match = re.exec(source);
  }

  return list;
}

/**
 * Pick a single-quoted or double-quoted literal property value.
 * @param {string} body - Object literal body.
 * @param {string} key - Property key.
 * @returns {string | null}
 */
function pick(body, key) {
  const re = new RegExp(`${key}\\s*:\\s*([\"'])` + '([\\s\\S]*?)' + '\\1');
  const match = body.match(re);
  return match ? match[2] : null;
}

/**
 * Collect source files for the package.
 * @param {string} pkg - Package name.
 * @returns {Promise<string[]>}
 */
async function files(pkg) {
  const script = `find packages/${pkg}/src -name "*.js" -type f`;
  const { default: cp } = await import('node:child_process');
  return new Promise(function run(resolve, reject) {
    cp.exec(script, { cwd: ROOT }, function done(error, stdout) {
      if (error) {
        reject(error);
        return;
      }
      const list = stdout
        .split('\n')
        .map(function trim(line) {
          return line.trim();
        })
        .filter(Boolean);
      resolve(list);
    });
  });
}

/**
 * Read package README.
 * @param {string} pkg - Package name.
 * @returns {Promise<string>}
 */
async function readme(pkg) {
  const file = path.join(ROOT, 'packages', pkg, 'README.md');
  return readFile(file, 'utf8');
}

/**
 * Check whether README documents a reference and fix playbook.
 * @param {string} doc - README content.
 * @param {string} method - Source method.
 * @param {string} ref - Error hash without `#`.
 * @returns {boolean}
 */
function documented(doc, method, ref) {
  const anchor = `id="error-${ref.toLowerCase()}"`;
  const anchorIndex = doc.indexOf(anchor);
  if (anchorIndex === -1) return false;
  const window = doc.slice(anchorIndex, anchorIndex + 5200);
  if (!window.includes(method)) return false;
  const hasSteps = /Step-by-step resolution:/i.test(window);
  const hasExample = /<details>/i.test(window) && /<summary>/i.test(window);
  return hasSteps && hasExample;
}

/**
 * Ensure source uses LayerError patterns and README docs.
 * @returns {Promise<void>}
 */
async function suite() {
  const missingDocs = [];
  const rawThrows = [];
  const positionalPlaceholders = [];
  const readmePositionalHeaders = [];

  for (const pkg of PACKAGES) {
    const doc = await readme(pkg);
    const badHeaders = doc.match(/^### .*%s.*$/gm) ?? [];
    for (const header of badHeaders) {
      readmePositionalHeaders.push(`${pkg}:${header}`);
    }
    const src = await files(pkg);

    for (const file of src) {
      const content = await readFile(path.join(ROOT, file), 'utf8');

      const raw = content.match(/throw\s+new\s+(?:TypeError|Error)\s*\(/g) ?? [];
      for (const _ of raw) {
        rawThrows.push(`${file}`);
      }

      const list = extractLayerErrors(content);
      for (const entry of list) {
        if (entry.message.includes('%s')) {
          positionalPlaceholders.push(`${file}:${entry.method}:${entry.message}`);
        }
        const ref = hashtag([entry.name, entry.method, entry.message].join('-')).slice(1);
        if (!documented(doc, entry.method, ref)) {
          missingDocs.push(`${pkg}:${entry.method}:${ref}:${file}`);
        }
      }
    }
  }

  assert.equal(rawThrows.length, 0, `Found raw Error/TypeError throws:\n${rawThrows.join('\n')}`);
  assert.equal(
    positionalPlaceholders.length,
    0,
    `Found positional %s placeholders in LayerError messages:\n${positionalPlaceholders.join('\n')}`
  );
  assert.equal(
    readmePositionalHeaders.length,
    0,
    `Found positional %s placeholders in README error headers:\n${readmePositionalHeaders.join('\n')}`
  );
  assert.equal(missingDocs.length, 0, `Found undocumented LayerError references:\n${missingDocs.join('\n')}`);
}

describe('@mcp-layer/error compliance', function compliance() {
  it('enforces LayerError usage and README remedies across packages', suite);
});
