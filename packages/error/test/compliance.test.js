import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashtag } from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const PACKAGES_ROOT = path.join(ROOT, 'packages');
const GATEWAY_VALIDATE_FILE = path.join(PACKAGES_ROOT, 'gateway', 'src', 'config', 'validate.js');

/**
 * Test whether a path exists.
 * @param {string} target - Absolute path.
 * @returns {Promise<boolean>}
 */
async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Collect package names that include `src/` and `README.md`.
 * @returns {Promise<string[]>}
 */
async function packages() {
  const entries = await readdir(PACKAGES_ROOT, { withFileTypes: true });
  const list = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const pkg = entry.name;
    const src = path.join(PACKAGES_ROOT, pkg, 'src');
    const readme = path.join(PACKAGES_ROOT, pkg, 'README.md');
    const hasSrc = await exists(src);
    const hasReadme = await exists(readme);

    if (hasSrc && hasReadme) list.push(pkg);
  }

  return list;
}

/**
 * Walk a directory recursively and collect JavaScript source files.
 * @param {string} dir - Absolute directory path.
 * @returns {Promise<string[]>}
 */
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const next = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await walk(next);
      files.push(...nested);
      continue;
    }

    if (entry.isFile() && next.endsWith('.js')) {
      files.push(next);
    }
  }

  return files;
}

/**
 * Resolve source files for a package.
 * @param {string} pkg - Package name.
 * @returns {Promise<string[]>}
 */
async function files(pkg) {
  return walk(path.join(PACKAGES_ROOT, pkg, 'src'));
}

/**
 * Read package README.
 * @param {string} pkg - Package name.
 * @returns {Promise<string>}
 */
async function readme(pkg) {
  const file = path.join(PACKAGES_ROOT, pkg, 'README.md');
  return readFile(file, 'utf8');
}

/**
 * Pick a single-quoted or double-quoted literal property value.
 * @param {string} body - Object literal body.
 * @param {string} key - Property key.
 * @returns {string | null}
 */
function pickLiteral(body, key) {
  const re = new RegExp(`${key}\\s*:\\s*([\"'])` + '([\\s\\S]*?)' + '\\1');
  const match = body.match(re);
  return match ? match[2] : null;
}

/**
 * Pick a non-literal expression for a property.
 * @param {string} body - Object literal body.
 * @param {string} key - Property key.
 * @returns {string | null}
 */
function pickExpression(body, key) {
  const re = new RegExp(`${key}\\s*:\\s*([^,\\n}]+)`);
  const match = body.match(re);
  if (!match) return null;
  return match[1].trim();
}

/**
 * Resolve possible `name` values from a LayerError object literal.
 * @param {string} body - Object literal body.
 * @param {string} fallback - Fallback package name for dynamic expressions.
 * @returns {string[]}
 */
function names(body, fallback) {
  const literal = pickLiteral(body, 'name');
  if (literal) return [literal];

  const expression = pickExpression(body, 'name');
  if (!expression) return [fallback];

  return [fallback];
}

/**
 * Parse string literal values from `new LayerError` calls.
 * @param {string} source - File source.
 * @param {string} fallback - Fallback package name for dynamic `name` fields.
 * @returns {Array<{ names: string[], method: string, message: string }>}
 */
function extractLayerErrors(source, fallback) {
  const list = [];
  const re = /new\s+LayerError\s*\(\s*\{([\s\S]*?)\}\s*\)/g;
  let match = re.exec(source);

  while (match) {
    const body = match[1] ?? '';
    const method = pickLiteral(body, 'method');
    const message = pickLiteral(body, 'message');
    const resolved = names(body, fallback);

    if (method && message) {
      list.push({ names: resolved, method, message });
    }

    match = re.exec(source);
  }

  return list;
}

/**
 * Collect package names that delegate runtime validation to gateway.
 * @param {string[]} list - Package names.
 * @returns {Promise<string[]>}
 */
async function delegates(list) {
  const set = new Set();

  for (const pkg of list) {
    const filesList = await files(pkg);

    for (const file of filesList) {
      const source = await readFile(file, 'utf8');
      const re = /validateRuntimeOptions\s*\(\s*[\s\S]*?,\s*\{([\s\S]*?)\}\s*\)/g;
      let match = re.exec(source);

      while (match) {
        const body = match[1] ?? '';
        const name = pickLiteral(body, 'name');
        if (name) set.add(name);
        match = re.exec(source);
      }
    }
  }

  return Array.from(set);
}

/**
 * Collect gateway runtime error signatures for delegated documentation checks.
 * @returns {Promise<Array<{ method: string, message: string }>>}
 */
async function gatewayErrors() {
  const source = await readFile(GATEWAY_VALIDATE_FILE, 'utf8');
  const list = extractLayerErrors(source, 'gateway');
  const dedupe = new Set();
  const out = [];

  for (const entry of list) {
    const key = `${entry.method}:${entry.message}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    out.push({ method: entry.method, message: entry.message });
  }

  return out;
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
 * Check whether README includes a matching anchor and method mention.
 * @param {string} doc - README content.
 * @param {string} method - Source method.
 * @param {string} ref - Error hash without `#`.
 * @returns {boolean}
 */
function linked(doc, method, ref) {
  const anchor = `id="error-${ref.toLowerCase()}"`;
  const anchorIndex = doc.indexOf(anchor);
  if (anchorIndex === -1) return false;
  const window = doc.slice(anchorIndex, anchorIndex + 1600);
  return window.includes(method);
}

/**
 * Collect `error-<hash>` anchors from README content.
 * @param {string} doc - README content.
 * @returns {Set<string>}
 */
function anchors(doc) {
  const set = new Set();
  const list = doc.matchAll(/id="(error-[0-9a-f]{6})"/gi);

  for (const match of list) {
    const value = match[1] ? match[1].toLowerCase() : '';
    if (value) set.add(value);
  }

  return set;
}

/**
 * Ensure source uses LayerError patterns and README docs.
 * @returns {Promise<void>}
 */
async function suite() {
  const pkgList = await packages();
  const directRefsByPackage = new Map();
  const delegatedRefsByPackage = new Map();
  const missingDocs = [];
  const missingDelegatedDocs = [];
  const strictMissing = [];
  const strictExtra = [];
  const rawThrows = [];
  const positionalPlaceholders = [];
  const readmePositionalHeaders = [];

  for (const pkg of pkgList) {
    const doc = await readme(pkg);
    const badHeaders = doc.match(/^### .*%s.*$/gm) ?? [];
    for (const header of badHeaders) {
      readmePositionalHeaders.push(`${pkg}:${header}`);
    }

    const src = await files(pkg);
    const refs = new Set();

    for (const file of src) {
      const content = await readFile(file, 'utf8');
      const rel = path.relative(ROOT, file);

      const raw = content.match(/throw\s+new\s+(?:TypeError|Error)\s*\(/g) ?? [];
      for (const _ of raw) {
        rawThrows.push(rel);
      }

      const list = extractLayerErrors(content, pkg);
      for (const entry of list) {
        if (entry.message.includes('%s')) {
          positionalPlaceholders.push(`${rel}:${entry.method}:${entry.message}`);
        }

        for (const name of entry.names) {
          const ref = hashtag([name, entry.method, entry.message].join('-')).slice(1).toLowerCase();
          refs.add(`error-${ref}`);
          if (!documented(doc, entry.method, ref)) {
            missingDocs.push(`${pkg}:${entry.method}:${ref}:${rel}`);
          }
        }
      }
    }

    directRefsByPackage.set(pkg, refs);
  }

  const delegatedNames = await delegates(pkgList);
  const sharedGatewayErrors = await gatewayErrors();

  for (const name of delegatedNames) {
    const docFile = path.join(PACKAGES_ROOT, name, 'README.md');
    if (!(await exists(docFile))) continue;

    const doc = await readFile(docFile, 'utf8');
    const refs = delegatedRefsByPackage.get(name) ?? new Set();

    for (const entry of sharedGatewayErrors) {
      const ref = hashtag([name, entry.method, entry.message].join('-')).slice(1).toLowerCase();
      refs.add(`error-${ref}`);
      if (!linked(doc, entry.method, ref)) {
        missingDelegatedDocs.push(`${name}:${entry.method}:${ref}:packages/${name}/README.md`);
      }
    }

    delegatedRefsByPackage.set(name, refs);
  }

  const strict = ['gateway', 'rest', 'graphql'];
  for (const pkg of strict) {
    const doc = await readme(pkg);
    const actual = anchors(doc);
    const expected = new Set();
    const direct = directRefsByPackage.get(pkg) ?? new Set();
    const delegated = delegatedRefsByPackage.get(pkg) ?? new Set();

    for (const ref of direct) expected.add(ref);
    for (const ref of delegated) expected.add(ref);

    for (const ref of expected) {
      if (!actual.has(ref)) strictMissing.push(`${pkg}:${ref}`);
    }

    for (const ref of actual) {
      if (!expected.has(ref)) strictExtra.push(`${pkg}:${ref}`);
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
  assert.equal(
    missingDelegatedDocs.length,
    0,
    `Found missing delegated gateway runtime references:\n${missingDelegatedDocs.join('\n')}`
  );
  assert.equal(
    strictMissing.length,
    0,
    `Found missing expected hash anchors in strict packages:\n${strictMissing.join('\n')}`
  );
  assert.equal(
    strictExtra.length,
    0,
    `Found unexpected extra hash anchors in strict packages:\n${strictExtra.join('\n')}`
  );
}

/**
 * Execute error compliance suite.
 * @returns {void}
 */
function compliance() {
  it('enforces LayerError usage and README remedies across packages', suite);
}

describe('@mcp-layer/error compliance', compliance);
