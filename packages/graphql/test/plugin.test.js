import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { attach } from '@mcp-layer/attach';
import { build } from '@mcp-layer/test-server';
import { createManager } from '@mcp-layer/manager';
import mcpGraphql from '../src/index.js';
import { setup, teardown, track } from './scope.js';

/**
 * Build and track a test server.
 * @param {Record<string, unknown>} [options] - Server options.
 * @returns {import('@mcp-layer/test-server').McpServer}
 */
function server(options = {}) {
  const out = build(options);
  track(async function close() {
    await out.close();
  });
  return out;
}

/**
 * Attach and track an MCP session.
 * @param {import('@mcp-layer/test-server').McpServer} svc - MCP test server.
 * @param {string} name - Session name.
 * @returns {Promise<import('@mcp-layer/session').Session>}
 */
async function session(svc, name) {
  const out = await attach(svc, name);
  track(async function close() {
    await out.close();
  });
  return out;
}

/**
 * Execute a GraphQL request through Fastify inject.
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {string} url - GraphQL endpoint path.
 * @param {string} query - GraphQL document.
 * @param {Record<string, unknown>} [variables] - GraphQL variables.
 * @param {Record<string, string>} [headers] - Request headers.
 * @returns {Promise<{ statusCode: number, body: Record<string, unknown> }>}
 */
async function graphql(fastify, url, query, variables = {}, headers = {}) {
  const response = await fastify.inject({
    method: 'POST',
    url,
    headers: {
      'content-type': 'application/json',
      ...headers
    },
    payload: {
      query,
      variables
    }
  });

  return {
    statusCode: response.statusCode,
    body: response.json()
  };
}

/**
 * Build a Fastify app with GraphQL plugin.
 * @param {import('@mcp-layer/session').Session | Array<import('@mcp-layer/session').Session>} session - Session input.
 * @param {Record<string, unknown>} [options] - GraphQL plugin options.
 * @returns {Promise<import('fastify').FastifyInstance>}
 */
async function app(session, options = {}) {
  const fastify = Fastify({ logger: false });
  await fastify.register(mcpGraphql, {
    session,
    ...options
  });
  track(async function close() {
    await fastify.close();
  });
  return fastify;
}

/**
 * Execute GraphQL plugin tests.
 * @returns {void}
 */
function suite() {
  beforeEach(setup);
  afterEach(teardown);

  it('serves generic and generated operations', async function operations() {
    const svc = server();
    const active = await session(svc, 'gql');
    const fastify = await app(active);

    const generic = await graphql(
      fastify,
      '/v0/graphql',
      'mutation ($input: JSON) { callTool(name: "echo", input: $input) { isError content } }',
      { input: { text: 'hello', loud: false } }
    );

    assert.equal(generic.statusCode, 200);
    assert.equal(generic.body.errors, undefined);
    assert.equal(generic.body.data.callTool.isError, false);
    assert.equal(Array.isArray(generic.body.data.callTool.content), true);
    assert.equal(generic.body.data.callTool.content[0].text, 'hello');

    const generated = await graphql(
      fastify,
      '/v0/graphql',
      'mutation ($input: JSON) { echo(input: $input) { isError content } }',
      { input: { text: 'generated', loud: false } }
    );

    assert.equal(generated.statusCode, 200);
    assert.equal(generated.body.errors, undefined);
    assert.equal(generated.body.data.echo.isError, false);
    assert.equal(Array.isArray(generated.body.data.echo.content), true);
    assert.equal(generated.body.data.echo.content[0].text, 'generated');
  });

  it('returns tool errors as GraphQL errors', async function tool() {
    const svc = server();
    const active = await session(svc, 'gql');
    const fastify = await app(active);

    const response = await graphql(
      fastify,
      '/v0/graphql',
      'mutation { callTool(name: "fail-gracefully", input: {}) { isError } }'
    );

    assert.equal(response.statusCode, 200);
    assert.equal(Array.isArray(response.body.errors), true);
    assert.equal(response.body.data, null);
    assert.equal(response.body.errors[0].extensions.code, 'TOOL_ERROR');
  });

  it('supports manager auth flows like REST', async function manager() {
    const svc = server();
    const bootstrap = await session(svc, 'bootstrap');

    /**
     * Create manager sessions.
     * @returns {Promise<import('@mcp-layer/session').Session>}
     */
    async function factory() {
      return bootstrap;
    }

    const manager = createManager({
      auth: { mode: 'required' },
      factory
    });

    const fastify = await app(bootstrap, { manager });

    const response = await graphql(
      fastify,
      '/v0/graphql',
      'mutation ($input: JSON) { callTool(name: "echo", input: $input) { isError } }',
      { input: { text: 'auth', loud: false } }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data, null);
    assert.equal(response.body.errors[0].extensions.code, 'UNAUTHENTICATED');
  });

  it('expands readTemplate URI templates with RFC6570 operators', async function templateOperators() {
    const svc = server();
    const active = await session(svc, 'gql');
    const fastify = await app(active);

    const response = await graphql(
      fastify,
      '/v0/graphql',
      'query ($tpl: String!, $params: JSON) { readTemplate(uriTemplate: $tpl, params: $params) { text } }',
      {
        tpl: 'template://note/{+name}',
        params: { name: 'hello' }
      }
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.errors, undefined);
    assert.equal(response.body.data.readTemplate.text, 'Template note for hello.');
  });

  it('redirects custom IDE routes within the scoped prefix', async function ideAlias() {
    const svc = server();
    const active = await session(svc, 'gql');
    const fastify = await app(active, {
      ide: {
        enabled: true,
        path: '/ide'
      }
    });

    const response = await fastify.inject({
      method: 'GET',
      url: '/v0/ide'
    });

    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, '/v0/graphiql');
  });

  it('registers isolated prefixes for multiple sessions', async function multi() {
    const oneServer = server({ info: { version: '1.0.0' } });
    const twoServer = server({ info: { version: '2.0.0' } });
    const one = await session(oneServer, 'one');
    const two = await session(twoServer, 'two');
    const fastify = await app([one, two]);

    assert.equal(fastify.hasRoute({ method: 'POST', url: '/v1/graphql' }), true);
    assert.equal(fastify.hasRoute({ method: 'POST', url: '/v2/graphql' }), true);
    assert.equal(fastify.hasRoute({ method: 'GET', url: '/v1/graphiql' }), false);
  });

  it('does not expose subscriptions in v1 schema', async function subscription() {
    const svc = server();
    const active = await session(svc, 'gql');
    const fastify = await app(active);

    const response = await graphql(
      fastify,
      '/v0/graphql',
      '{ __schema { subscriptionType { name } } }'
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.errors, undefined);
    assert.equal(response.body.data.__schema.subscriptionType, null);
  });
}

describe('graphql plugin', suite);
