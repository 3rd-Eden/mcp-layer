import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { path, tpath, uri } from '../src/routing.js';

/**
 * Return mapping fixtures for forward mapping tests.
 * @returns {Array<{ uri: string, path: string }>}
 */
function forwardCases() {
  return [
    { uri: '/docs/readme.md', path: '/docs/readme.md' },
    { uri: 'ui://dashboard/index.html', path: '/ui/dashboard/index.html' },
    { uri: 'ui://', path: '/ui/_' },
    { uri: 'test://config', path: '/test/config/_' },
    { uri: 'notes/intro', path: '/notes/intro' },
    { uri: 'db://postgres/users/123', path: '/db/postgres/users/123' }
  ];
}

/**
 * Return mapping fixtures for round-trip tests.
 * @returns {Array<{ uri: string, path: string }>}
 */
function roundtripCases() {
  return [
    { uri: '/docs/readme.md', path: '/docs/readme.md' },
    { uri: 'ui://dashboard/index.html', path: '/ui/dashboard/index.html' },
    { uri: 'ui://', path: '/ui/_' },
    { uri: 'test://config', path: '/test/config/_' },
    { uri: 'notes/intro', path: '/notes/intro' },
    { uri: 'db://postgres/users/123', path: '/db/postgres/users/123' }
  ];
}

/**
 * Execute mapping tests.
 * @returns {void}
 */
function mappingSuite() {
  it('maps MCP resource URIs to HTTP paths', function mapForwardCase() {
    const list = forwardCases();

    for (const item of list) {
      const got = path(item.uri);
      assert.equal(got, item.path);
    }
  });

  it('supports percent-encoding segments', function mapEncodedCase() {
    const uri = 'notes/My File.txt';
    const route = path(uri, true);
    assert.equal(route, '/notes/My%20File.txt');
  });

  it('supports disabling encoding', function mapPlainCase() {
    const uri = 'notes/My File.txt';
    const route = path(uri, false);
    assert.equal(route, '/notes/My File.txt');
  });

  it('round-trips mapped paths back to URIs', function mapRoundtripCase() {
    const list = roundtripCases();

    for (const item of list) {
      const got = uri(item.path);
      assert.equal(got, item.uri);
    }
  });

  it('maps resource templates to route paths', function templateCase() {
    const route = tpath('template://note/{name}');
    assert.equal(route, '/template/note/{name}');
  });
}

describe('openapi routing mapping', mappingSuite);
