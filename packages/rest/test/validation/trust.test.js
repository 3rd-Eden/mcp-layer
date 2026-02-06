import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { attach } from '@mcp-layer/attach';
import { Session } from '@mcp-layer/session';
import { build } from '../../../test-server/src/index.js';
import { shouldTrustSchemas } from '../../src/validation/trust.js';

/**
 * Build a test session using in-memory transport.
 *
 * without spawning external processes.
 *
 * @returns {Promise<{ session: Session, server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer }>}
 */
async function inmem() {
  const server = build();
  const session = await attach(server, 'inmem');
  return { session, server };
}

/**
 * Build a test session using stdio transport.
 *
 * avoid spawning a child process during tests.
 *
 * @returns {Promise<Session>}
 */
async function stdio() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: []
  });
  const client = new Client({ name: 'rest-test', version: '0.0.0' });
  return new Session({
    name: 'stdio',
    source: 'stdio',
    entry: null,
    client,
    transport,
    info: { name: 'rest-test', version: '0.0.0' }
  });
}

/**
 * Build a test session using Streamable HTTP transport.
 *
 * requiring a real HTTP server.
 *
 * @returns {Promise<Session>}
 */
async function remote() {
  const transport = new StreamableHTTPClientTransport({
    url: 'http://127.0.0.1:0/mcp'
  });
  const client = new Client({ name: 'rest-test', version: '0.0.0' });
  const session = new Session({
    name: 'remote',
    source: 'http',
    entry: null,
    client,
    transport,
    info: { name: 'rest-test', version: '0.0.0' }
  });
  return session;
}

/**
 * Execute trust model tests.
 * @returns {void}
 */
function trustSuite() {
  it('trusts attach sessions with auto policy', async function trustAttachCase() {
    const data = await inmem();
    const session = data.session;
    try {
      assert.equal(shouldTrustSchemas(session, 'auto'), true);
    } finally {
      await session.close();
      await data.server.close();
    }
  });

  it('trusts connect sessions with auto policy', async function trustStdioCase() {
    const session = await stdio();
    try {
      assert.equal(shouldTrustSchemas(session, 'auto'), true);
    } finally {
      await session.close();
    }
  });

  it('distrusts remote sessions with auto policy', async function trustRemoteCase() {
    const session = await remote();
    try {
      assert.equal(shouldTrustSchemas(session, 'auto'), false);
    } finally {
      await session.close();
    }
  });

  it('always trusts with true policy', async function trustAlwaysCase() {
    const data = await inmem();
    const session = data.session;
    try {
      assert.equal(shouldTrustSchemas(session, true), true);
    } finally {
      await session.close();
      await data.server.close();
    }
  });

  it('never trusts with false policy', async function trustNeverCase() {
    const data = await inmem();
    const session = data.session;
    try {
      assert.equal(shouldTrustSchemas(session, false), false);
    } finally {
      await session.close();
      await data.server.close();
    }
  });
}

describe('schema trust model', trustSuite);
