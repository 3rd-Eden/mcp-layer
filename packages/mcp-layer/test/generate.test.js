import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildIndex, collectPackageMeta, findWorkspaceRoot, readJson } from '../src/generate.js';

/**
 * Ensure the generated index.js matches the committed file.
 * @returns {Promise<void>}
 */
async function matchesGeneratedOutput() {
  const rootDir = await findWorkspaceRoot(process.cwd());
  const pkgDir = path.join(rootDir, 'packages', 'mcp-layer');
  const outFile = path.join(pkgDir, 'src', 'index.js');
  const expected = await buildIndex(rootDir);
  const actual = await readFile(outFile, 'utf8');

  assert.equal(actual, expected);
}

test('mcp-layer index matches generator output', matchesGeneratedOutput);

/**
 * Ensure mcp-layer package dependencies include all workspace packages.
 * @returns {Promise<void>}
 */
async function matchesDependencies() {
  const rootDir = await findWorkspaceRoot(process.cwd());
  const pkgPath = path.join(rootDir, 'packages', 'mcp-layer', 'package.json');
  const pkg = await readJson(pkgPath);
  const deps = pkg.dependencies ?? {};
  const meta = await collectPackageMeta(rootDir, new Set(['mcp-layer']));
  const names = new Set();

  for (const item of meta) {
    if (!item.name.startsWith('@mcp-layer/')) continue;
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
