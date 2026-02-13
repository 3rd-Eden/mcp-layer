#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

/**
 * Execute `changeset status` with stable terminal dimensions.
 * @returns {never}
 */
function run() {
  const env = {
    ...process.env,
    COLUMNS: process.env.COLUMNS ?? '120',
    LINES: process.env.LINES ?? '40',
  };

  const cmd = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(cmd, ['changeset', 'status'], {
    env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;

  const code = result.status ?? 1;
  process.exit(code);
}

run();
