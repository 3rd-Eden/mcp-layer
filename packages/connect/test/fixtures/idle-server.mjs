import { writeFileSync } from 'node:fs';

/**
 * No-op interval callback to keep the process alive.
 * @returns {void}
 */
function tick() {}

/**
 * Resolve an optional path where the fixture should write its process id.
 * @returns {string | undefined}
 */
function pidfile() {
  const value = process.argv.at(2);
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return value;
}

/**
 * Persist the current process id when a pid output file is provided by the caller.
 * @returns {void}
 */
function recordpid() {
  const file = pidfile();
  if (!file) return;
  writeFileSync(file, `${process.pid}\n`, 'utf8');
}

/**
 * Keep the test process running to simulate an unresponsive MCP server.
 * @returns {NodeJS.Timeout}
 */
function keepalive() {
  return setInterval(tick, 1000);
}

recordpid();
keepalive();
