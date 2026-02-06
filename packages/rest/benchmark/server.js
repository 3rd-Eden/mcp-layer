import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import { build } from '@mcp-layer/test-server';
import mcpRest from '@mcp-layer/rest';
import { createManager } from '@mcp-layer/manager';
import { connect } from '@mcp-layer/connect';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from './config.js';

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
      manager: manager
    });
  } else {
    await app.register(mcpRest, {
      session: sessions
    });
  }

  await app.listen({ host: cfg.host, port: cfg.port });

  return { app, sessions, servers, manager };
}

/**
 * Close a benchmark server and all MCP sessions.
 * @param {{ app: import('fastify').FastifyInstance, sessions: Array<import('@mcp-layer/session').Session>, servers: Array<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer>, manager?: ReturnType<typeof createManager> }} bundle - Server bundle.
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
 * Handle fatal errors.
 * @param {Error} err - Error to report.
 * @returns {void}
 */
function fail(err) {
  console.error(err);
  process.exitCode = 1;
}

/**
 * Start the benchmark server and wait for termination.
 * @returns {Promise<void>}
 */
async function main() {
  const cfg = load(process.argv.slice(2));
  const bundle = await setup(cfg);
  const addr = bundle.app.server.address();
  const port = addr && typeof addr === 'object' ? addr.port : cfg.port;

  console.log(`REST benchmark server listening on http://${cfg.host}:${port}`);

  /**
   * Handle shutdown.
   * @returns {Promise<void>}
   */
  async function shutdown() {
    await close(bundle);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(fail);
