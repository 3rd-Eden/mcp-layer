import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import mcpRest from '@mcp-layer/rest';
import { build } from '@mcp-layer/test-server';

/**
 * Build a shared MCP test server with optional metadata overrides.
 *
 * avoid drifting from real MCP behavior.
 *
 * @param {{ name?: string, version?: string, tools?: Array<unknown>, resources?: Array<unknown>, prompts?: Array<unknown> }} config - Server metadata overrides.
 * @returns {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer}
 */
export function createTestMcpServer(config = {}) {
  if (Array.isArray(config.tools) || Array.isArray(config.resources) || Array.isArray(config.prompts)) {
    throw new Error('Custom tools/resources/prompts are not supported in REST tests; use the shared test server.');
  }

  const info = {};
  if (config.name) info.name = config.name;
  if (config.version) info.version = config.version;

  return build(Object.keys(info).length ? { info } : undefined);
}

/**
 * Create a Fastify instance with MCP REST plugin registered.
 *
 *
 * @param {{ name?: string, version?: string, tools?: Array<{ name: string, description?: string, inputSchema?: Record<string, unknown>, handler: (args: Record<string, unknown>) => any }>, resources?: Array<{ uri: string, name: string, mimeType?: string, content: string }>, prompts?: Array<{ name: string, description?: string, arguments?: Array<Record<string, unknown>>, handler: (args: Record<string, unknown>) => any }> }} mcpConfig - MCP server configuration.
 * @param {Record<string, unknown>} [pluginOptions] - REST plugin options.
 * @returns {Promise<{ fastify: import('fastify').FastifyInstance, mcp: McpServer, session: import('@mcp-layer/session').Session }>}
 */
export async function createTestApp(mcpConfig = {}, pluginOptions = {}) {
  const mcp = createTestMcpServer(mcpConfig);
  const session = await attach(mcp, mcpConfig.name ?? 'test');
  const fastify = Fastify({ logger: false });

  await fastify.register(mcpRest, {
    session,
    ...pluginOptions
  });

  return { fastify, mcp, session };
}

/**
 * Close a test app and its associated MCP server/session.
 *
 * resources consistently to avoid hanging test runs.
 *
 * @param {{ fastify: import('fastify').FastifyInstance, mcp: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer, session: import('@mcp-layer/session').Session }} app - Test app bundle.
 * @returns {Promise<void>}
 */
export async function closeTestApp(app) {
  if (!app) return;

  if (app.fastify && app.fastify.mcpBreakers) {
    for (const breaker of app.fastify.mcpBreakers.values()) {
      breaker.shutdown();
    }
  }

  if (app.fastify) await app.fastify.close();

  if (app.session) await app.session.close();

  if (app.mcp) await app.mcp.close();
}

/**
 * Create a Fastify instance with multiple MCP sessions.
 *
 *
 * @param {Array<{ name: string, version?: string, tools?: Array<{ name: string, description?: string, inputSchema?: Record<string, unknown>, handler: (args: Record<string, unknown>) => any }>, resources?: Array<{ uri: string, name: string, mimeType?: string, content: string }>, prompts?: Array<{ name: string, description?: string, arguments?: Array<Record<string, unknown>>, handler: (args: Record<string, unknown>) => any }> }>} mcpConfigs - MCP server configurations.
 * @param {Record<string, unknown>} [pluginOptions] - REST plugin options.
 * @returns {Promise<{ fastify: import('fastify').FastifyInstance, sessions: Array<import('@mcp-layer/session').Session> }>} 
 */
export async function createMultiSessionApp(mcpConfigs, pluginOptions = {}) {
  const sessions = [];
  const mcps = [];

  for (const cfg of mcpConfigs) {
    const mcp = createTestMcpServer(cfg);
    const session = await attach(mcp, cfg.name);
    sessions.push(session);
    mcps.push(mcp);
  }

  const fastify = Fastify({ logger: false });
  await fastify.register(mcpRest, {
    session: sessions,
    ...pluginOptions
  });

  return { fastify, sessions, mcps };
}

/**
 * Close a multi-session Fastify app and all associated MCP sessions.
 *
 *
 * @param {{ fastify: import('fastify').FastifyInstance, sessions: Array<import('@mcp-layer/session').Session>, mcps: Array<import('@modelcontextprotocol/sdk/server/mcp.js').McpServer> }} app - Multi-session bundle.
 * @returns {Promise<void>}
 */
export async function closeMultiSessionApp(app) {
  if (!app) return;

  if (app.fastify && app.fastify.mcpBreakers) {
    for (const breaker of app.fastify.mcpBreakers.values()) {
      breaker.shutdown();
    }
  }

  if (app.fastify) await app.fastify.close();

  if (Array.isArray(app.sessions)) {
    for (const session of app.sessions) {
      await session.close();
    }
  }

  if (Array.isArray(app.mcps)) {
    for (const mcp of app.mcps) {
      await mcp.close();
    }
  }
}
