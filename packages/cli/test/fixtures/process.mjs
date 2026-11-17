import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../../bin/cli.js', import.meta.url));

/**
 * Run a real long-lived CLI until its endpoint is announced on stderr.
 * @param {import('node:test').TestContext} t Test cleanup lifecycle.
 * @param {string[]} args CLI arguments.
 * @param {string} [entry=bin] Optional public builder fixture.
 * @returns {Promise<{url:string,close:()=>Promise<void>,stdout:()=>string}>} Started CLI and graceful SIGTERM shutdown.
 */
export async function host(t, args, entry = bin) {
  const child = spawn(process.execPath, [entry, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
  let output = '';
  let errors = '';
  const exited = new Promise(
    /**
     * Complete the real test lifecycle.
     * @param {(code:number|null)=>void} resolve Complete the observed lifecycle event.
     * @returns {void} Completion of the real test operation.
     */
    function completion(resolve) { child.once('exit', resolve); });
  const url = await new Promise(
    /**
     * Wait for the running CLI to announce its endpoint.
     * @param {(url:string)=>void} resolve Complete the observed lifecycle event.
     * @param {(cause:unknown)=>void} reject Report startup failure.
     * @returns {void} Completion of the real test operation.
     */
    function ready(resolve, reject) {
      const timer = setTimeout(
        /**
         * Fail startup and stop the subprocess after its deadline.
         * @returns {void} Completion of the real test operation.
         */
        function timeout() { reject(new Error(`CLI endpoint was not announced: ${errors}`)); child.kill(); }, 5000);
      child.once('error', reject);
      child.once('exit',
        /**
         * Reject startup when the actual subprocess exits early.
         * @param {number|null} code Subprocess exit code.
         * @returns {void} Completion of the real test operation.
         */
        function early(code) { clearTimeout(timer); reject(new Error(`CLI exited before startup (${code}): ${errors}`)); });
      child.stdout.on('data',
        /**
         * Collect actual subprocess output.
         * @param {Buffer} value Bytes emitted by the subprocess.
         * @returns {void} Completion of the real test operation.
         */
        function chunk(value) { output += value; });
      child.stderr.on('data',
        /**
         * Collect actual subprocess output.
         * @param {Buffer} value Bytes emitted by the subprocess.
         * @returns {void} Completion of the real test operation.
         */
        function chunk(value) {
          errors += value;
          const endpoint = errors.match(/^https?:\/\/\S+$/m)?.[0];
          if (endpoint) { clearTimeout(timer); resolve(endpoint); }
        });
    });
  /** @returns {Promise<void>} Stop the child using its real signal lifecycle. */
  async function close() { if (child.exitCode === null) child.kill('SIGTERM'); await exited; }
  t.after(close);
  /** @returns {string} All stdout emitted by this process. */
  function stdout() { return output; }
  return { url, close, stdout };
}
