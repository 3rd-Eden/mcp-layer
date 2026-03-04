import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const root = process.cwd();
const packages = path.join(root, 'packages');

/**
 * List publishable package directories in the workspace.
 * @returns {string[]}
 */
function dirs() {
  return readdirSync(packages)
    .map(function join(name) {
      return path.join(packages, name);
    })
    .filter(function file(dir) {
      return existsSync(path.join(dir, 'package.json'));
    });
}

/**
 * Read and parse a package manifest from disk.
 * @param {string} dir - Absolute package directory.
 * @returns {Record<string, unknown>}
 */
function manifest(dir) {
  const file = path.join(dir, 'package.json');
  return JSON.parse(readFileSync(file, 'utf8'));
}

/**
 * Resolve exported entry definitions that should expose declaration files.
 * @param {Record<string, unknown>} pkg - Parsed package manifest.
 * @returns {Array<[string, Record<string, unknown>]>}
 */
function entries(pkg) {
  const map = /** @type {Record<string, unknown>} */ (pkg.exports ?? {});
  return Object.entries(map).filter(function runtime([key, value]) {
    return key !== './package.json' && Boolean(value && typeof value === 'object' && !Array.isArray(value));
  });
}

/**
 * Check whether a directory contains any declaration files.
 * @param {string} dir - Absolute types directory.
 * @returns {boolean}
 */
function declarations(dir) {
  if (!existsSync(dir)) return false;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory() && declarations(file)) return true;
    if (entry.isFile() && entry.name.endsWith('.d.ts')) return true;
  }

  return false;
}

/**
 * Verify that every package publishes a generated declaration directory.
 * @returns {void}
 */
function assertPublishedTypes() {
  for (const dir of dirs()) {
    const pkg = manifest(dir);
    const types = /** @type {string | undefined} */ (pkg.types);
    const files = /** @type {string[] | undefined} */ (pkg.files);
    const out = path.join(dir, 'types');

    assert.equal(typeof pkg.scripts, 'object', `${pkg.name} must declare scripts`);
    assert.equal(typeof pkg.scripts?.['build:types'], 'string', `${pkg.name} must declare build:types`);
    assert.equal(typeof pkg.scripts?.prepublishOnly, 'string', `${pkg.name} must declare prepublishOnly`);
    assert.equal(typeof types, 'string', `${pkg.name} must declare a top-level types entry`);
    assert.equal(files?.includes('types'), true, `${pkg.name} must publish the generated types directory`);
    assert.equal(declarations(out), true, `${pkg.name} must emit declaration files into ${out}`);
    assert.equal(existsSync(path.join(dir, types ?? 'missing.d.ts')), true, `${pkg.name} types entry must resolve to a generated file`);
  }
}

/**
 * Verify that each exported runtime entrypoint exposes a matching declaration target.
 * @returns {void}
 */
function assertExportedTypes() {
  for (const dir of dirs()) {
    const pkg = manifest(dir);

    for (const [key, entry] of entries(pkg)) {
      const ref = /** @type {{ types?: string }} */ (entry).types;
      assert.equal(typeof ref, 'string', `${pkg.name} export ${key} must declare a types target`);
      assert.equal(existsSync(path.join(dir, ref ?? 'missing.d.ts')), true, `${pkg.name} export ${key} types target must exist on disk`);
    }
  }
}

/**
 * Register declaration export verification tests.
 * @returns {void}
 */
function suite() {
  it('publishes generated declaration directories for every package', assertPublishedTypes);
  it('maps every exported runtime entrypoint to a generated declaration file', assertExportedTypes);
}

describe('workspace type exports', suite);
