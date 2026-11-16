import { run } from '../../src/cli.js';
import { browser } from './browser.mjs';

/** @returns {Promise<void>} Run the profile utility with real OAuth browser handling. */
async function main() { await run(process.argv.slice(2), { open: browser }); }
main().catch(/** @param {Error} error Startup or CLI execution failure. @returns {void} Report failure and set the process exit status. */
function fatal(error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
