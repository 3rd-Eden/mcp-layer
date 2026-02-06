import Fastify from 'fastify';
import autocannon from 'autocannon';
import { attach } from '@mcp-layer/attach';
import { build } from '@mcp-layer/test-server';
import mcpRest from '@mcp-layer/rest';
import { createManager } from '@mcp-layer/manager';
import { connect } from '@mcp-layer/connect';
import { deriveApiVersion } from '../src/routing/version.js';
import { load } from './config.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build a REST prefix for each session.
 * @param {string} version - API version.
 * @param {Record<string, unknown> | undefined} info - MCP server info.
 * @param {string} name - Session name.
 * @returns {string}
 */
function prefix(version, info, name) {
  return `/mcp/${name}/${version}`;
}

/**
 * Extract a numeric port from a server address.
 * @param {import('node:net').AddressInfo | string | null} addr - Server address.
 * @returns {number}
 */
function port(addr) {
  if (addr && typeof addr === 'object' && typeof addr.port === 'number') return addr.port;
  throw new Error('Expected server to listen on a TCP port.');
}

/**
 * Pick a session name from a list based on a target string.
 * @param {string} target - Target name or index.
 * @param {Array<{ name: string }>} sessions - Sessions list.
 * @returns {{ name: string, index: number }}
 */
function pick(target, sessions) {
  const idx = Number(target);
  if (Number.isInteger(idx) && idx >= 0 && idx < sessions.length) {
    return { name: sessions[idx].name, index: idx };
  }

  for (let pos = 0; pos < sessions.length; pos += 1) {
    const session = sessions[pos];
    if (session && session.name === target) {
      return { name: session.name, index: pos };
    }
  }

  throw new Error(`Target session \"${target}\" was not found.`);
}

/**
 * Join a prefix with a tool name.
 * @param {string} root - Prefix path.
 * @param {string} tool - Tool name.
 * @returns {string}
 */
function join(root, tool) {
  const left = root.endsWith('/') ? root.slice(0, -1) : root;
  const right = tool.startsWith('/') ? tool.slice(1) : tool;
  return `${left}/${right}`;
}

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
 * Resolve the test-server stdio entry path.
 * @returns {string}
 */
function testServerBin() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'test-server', 'src', 'bin.js');
}

/**
 * Create a stdio session using @mcp-layer/connect.
 * @param {string} name - Session name.
 * @returns {Promise<import('@mcp-layer/session').Session>}
 */
async function createStdioSession(name) {
  const bin = testServerBin();
  const entry = {
    name,
    source: bin,
    config: {
      command: process.execPath,
      args: [bin]
    }
  };
  const map = new Map([[name, entry]]);
  return connect(map, name);
}

/**
 * Create an in-memory session using attach().
 * @param {string} name - Session name.
 * @returns {Promise<{ session: import('@mcp-layer/session').Session, server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer }>}
 */
async function createMemorySession(name) {
  const server = build();
  const session = await attach(server, name);
  return { session, server };
}

/**
 * Build MCP sessions and a REST server for benchmarking.
 * @param {{ sessions: number, host: string, port: number, mode: string, transport: string, authMode: string, authScheme: string, authHeader: string }} cfg - Benchmark config.
 * @returns {Promise<{ app: import('fastify').FastifyInstance, sessions: Array<import('@mcp-layer/session').Session>, servers: Array<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>, manager?: ReturnType<typeof createManager> }>}
 */
async function setup(cfg) {
  const sessions = [];
  const servers = [];
  let manager;

  if (cfg.mode === 'manager') {
    if (cfg.transport === 'stdio') {
      const catalogSession = await createStdioSession('catalog');
      sessions.push(catalogSession);
    } else {
      const catalog = await createMemorySession('catalog');
      sessions.push(catalog.session);
      servers.push(catalog.server);
    }

    const state = { count: 0 };

    /**
     * Build a new session for the manager.
     * @param {{ identity: { key: string } }} ctx - Session context.
     * @returns {Promise<import('@mcp-layer/session').Session>}
     */
    async function factory(ctx) {
      state.count += 1;
      if (cfg.transport === 'stdio') {
        return createStdioSession(`bench-${ctx.identity.key}-${state.count}`);
      }
      const entry = await createMemorySession(`bench-${ctx.identity.key}-${state.count}`);
      servers.push(entry.server);
      return entry.session;
    }

    manager = createManager({
      max: cfg.sessions,
      ttl: 5 * 60 * 1000,
      auth: {
        mode: cfg.authMode,
        header: cfg.authHeader,
        scheme: cfg.authScheme
      },
      factory
    });
  } else {
    for (let idx = 0; idx < cfg.sessions; idx += 1) {
      if (cfg.transport === 'stdio') {
        const session = await createStdioSession(`bench-${idx + 1}`);
        sessions.push(session);
      } else {
        const entry = await createMemorySession(`bench-${idx + 1}`);
        sessions.push(entry.session);
        servers.push(entry.server);
      }
    }
  }

  const app = Fastify({ logger: false });
  if (manager) {
    await app.register(mcpRest, {
      session: sessions[0],
      manager: manager,
      prefix
    });
  } else {
    await app.register(mcpRest, {
      session: sessions,
      prefix
    });
  }

  await app.listen({ host: cfg.host, port: cfg.port });

  return { app, sessions, servers, manager };
}

/**
 * Close a benchmark server and all MCP sessions.
 * @param {{ app: import('fastify').FastifyInstance, sessions: Array<import('@mcp-layer/session').Session>, servers: Array<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>, manager?: ReturnType<typeof createManager> }} bundle - Benchmark bundle.
 * @returns {Promise<void>}
 */
async function close(bundle) {
  if (bundle.app) await bundle.app.close();

  if (bundle.manager) await bundle.manager.close();

  if (Array.isArray(bundle.sessions)) {
    for (const session of bundle.sessions) {
      await session.close();
    }
  }

  if (Array.isArray(bundle.servers)) {
    for (const server of bundle.servers) {
      await server.close();
    }
  }
}

/**
 * Run an autocannon load test.
 * @param {{ connections: number, duration: number, pipelining: number, timeout: number, method: string, mode: string, authMode: string, authScheme: string, authHeader: string, identities: number }} cfg - Benchmark config.
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
    const useAuth = cfg.mode === 'manager' && cfg.authMode !== 'disabled' && (cfg.identities > 1 || cfg.authMode === 'required');
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
     * @param {{ clientId: number }} context - Autocannon context.
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
 * Orchestrate the benchmark run.
 * @returns {Promise<void>}
 */
async function main() {
  const cfg = load(process.argv.slice(2));
  const bundle = await setup(cfg);

  try {
    const addr = bundle.app.server.address();
    const portNum = port(addr);
    const target = pick(cfg.target, bundle.sessions);
    const serverInfo = bundle.servers[target.index] && bundle.servers[target.index].info ? bundle.servers[target.index].info : undefined;
    const version = deriveApiVersion(serverInfo);
    const base = prefix(version, serverInfo, target.name);
    const path = join(base, cfg.tool);
    const url = `http://${cfg.host}:${portNum}${path}`;
    const body = cfg.payload ? cfg.payload : JSON.stringify({ text: cfg.text, loud: cfg.loud });

    const res = await run(cfg, url, body);
    report(cfg, url, res);
  } finally {
    await close(bundle);
  }
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

main().catch(fail);
