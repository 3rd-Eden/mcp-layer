import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const directory = fileURLToPath(new URL('../', import.meta.url));

/** @returns {void} Register generated declaration consumer checks. */
function suite() {
  /**
   * Compile a strict package consumer against the generated public declarations and official SDK.
   * @returns {Promise<void>} Completes when valid and intentionally invalid usage is checked.
   */
  async function consumer() {
    const result = await execute(process.execPath, [
      require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'nodenext',
      '--moduleResolution', 'nodenext', '--target', 'es2022', '--skipLibCheck',
      'test/fixtures/consumer.ts',
    ], { cwd: directory });
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
  it('supports strict TypeScript consumers and official SDK transport options', consumer);
}

describe('@mcp-layer/profiles declarations', suite);
