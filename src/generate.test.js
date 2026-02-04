import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildIndex, collectPackageMeta, readJson } from './generate.js';

/**
 * Ensure the generated index.js matches the committed file.
 * @returns {Promise<void>}
 */
async function matchesGeneratedOutput() {
  const rootDir = process.cwd();
  const outFile = path.join(rootDir, 'src', 'index.js');
  const expected = await buildIndex(rootDir);
  const actual = await readFile(outFile, 'utf8');

  assert.equal(actual, expected);
}

test('mcp-layer index matches generator output', matchesGeneratedOutput);

/**
 * Ensure root package.json dependencies include all workspace packages.
 * @returns {Promise<void>}
 */
async function matchesDependencies() {
  const rootDir = process.cwd();
  const pkgPath = path.join(rootDir, 'package.json');
  const rootPkg = await readJson(pkgPath);
  const deps = rootPkg.dependencies ?? {};
  const meta = await collectPackageMeta(rootDir);
  const names = new Set();

  for (const item of meta) {
    names.add(item.name);
    assert.equal(
      deps[item.name],
      'workspace:*',
      `Expected dependency ${item.name} to be set to workspace:*`,
    );
  }

  for (const key of Object.keys(deps)) {
    if (key.startsWith('@mcp-layer/')) {
      assert.ok(
        names.has(key),
        `Expected dependency ${key} to map to a workspace package`,
      );
    }
  }
}

test('mcp-layer dependencies include workspace packages', matchesDependencies);
