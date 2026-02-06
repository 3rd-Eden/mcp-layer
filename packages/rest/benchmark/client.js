import autocannon from 'autocannon';
import { load } from './config.js';

/**
 * Build a list of identity tokens.
 * @param {number} count - Number of identities.
 * @returns {string[]}
 */
function tokens(count) {
  const list = [];
  for (let idx = 0; idx < count; idx += 1) {
    list.push(`token-${idx + 1}`);
  }
  return list;
}

/**
 * Format an auth header.
 * @param {{ authScheme: string }} cfg - Benchmark config.
 * @param {string} token - Token string.
 * @returns {string}
 */
function formatAuth(cfg, token) {
  if (cfg.authScheme === 'basic') {
    return `Basic ${token}`;
  }
  if (cfg.authScheme === 'raw') return token;
  return `Bearer ${token}`;
}

/**
 * Run an autocannon load test.
 * @param {{ connections: number, duration: number, pipelining: number, timeout: number, method: string, authMode: string, authScheme: string, authHeader: string, identities: number }} cfg - Benchmark config.
 * @param {string} url - Target URL.
 * @param {string} body - JSON body.
 * @returns {Promise<import('autocannon').Result>}
 */
function run(cfg, url, body) {
  return new Promise(executor);

  /**
   * Promise executor for autocannon.
   * @param {(result: import('autocannon').Result) => void} resolve - Resolve handler.
   * @param {(error: Error) => void} reject - Reject handler.
   * @returns {void}
   */
  function executor(resolve, reject) {
    const useAuth = cfg.authMode !== 'disabled' && (cfg.identities > 1 || cfg.authMode === 'required');
    const list = tokens(cfg.identities);
    const opts = {
      url,
      connections: cfg.connections,
      duration: cfg.duration,
      pipelining: cfg.pipelining,
      timeout: cfg.timeout,
      method: cfg.method,
      headers: {
        'content-type': 'application/json'
      },
      body,
      setupClient: useAuth ? setupClient : undefined
    };

    const inst = autocannon(opts, done);
    autocannon.track(inst, { renderProgressBar: true });

    /**
     * Configure per-connection auth headers.
     * @param {import('autocannon').Client} client - Autocannon client.
     * @param {{ clientId?: number }} context - Autocannon context.
     * @returns {void}
     */
    function setupClient(client, context) {
      const ctx = context ?? {};
      const idx = Number.isInteger(ctx.clientId) ? ctx.clientId : 0;
      const token = list[idx % list.length];
      const auth = formatAuth(cfg, token);
      client.setHeaders({
        'content-type': 'application/json',
        [cfg.authHeader]: auth
      });
    }

    /**
     * Handle autocannon completion.
     * @param {Error | null} err - Error result.
     * @param {import('autocannon').Result} res - Benchmark result.
     * @returns {void}
     */
    function done(err, res) {
      if (err) {
        reject(err);
        return;
      }
      resolve(res);
    }
  }
}

/**
 * Print a simple benchmark summary.
 * @param {{ connections: number, duration: number, pipelining: number }} cfg - Benchmark config.
 * @param {string} url - Target URL.
 * @param {import('autocannon').Result} res - Benchmark result.
 * @returns {void}
 */
function report(cfg, url, res) {
  const latency = res.latency;
  const req = res.requests;
  const throughput = res.throughput;

  console.log('Benchmark summary');
  console.log(`Target: ${url}`);
  console.log(`Connections: ${cfg.connections}`);
  console.log(`Duration: ${cfg.duration}s`);
  console.log(`Pipelining: ${cfg.pipelining}`);
  console.log(`Requests/sec: ${Math.round(req.average)}`);
  console.log(`Latency avg (ms): ${Math.round(latency.average)}`);
  console.log(`Latency p99 (ms): ${Math.round(latency.p99)}`);
  console.log(`Throughput avg (bytes/sec): ${Math.round(throughput.average)}`);
  console.log(`Non-2xx responses: ${res.non2xx}`);
}

/**
 * Handle fatal errors.
 * @param {Error} err - Error to report.
 * @returns {void}
 */
function fail(err) {
  console.error(err);
  process.exitCode = 1;
}

/**
 * Orchestrate the client run.
 * @returns {Promise<void>}
 */
async function main() {
  const cfg = load(process.argv.slice(2));
  const url = cfg.url;
  if (!url) throw new Error('url must be provided.');
  const body = cfg.payload ? cfg.payload : JSON.stringify({ text: cfg.text, loud: cfg.loud });
  const res = await run(cfg, url, body);
  report(cfg, url, res);
}

main().catch(fail);
