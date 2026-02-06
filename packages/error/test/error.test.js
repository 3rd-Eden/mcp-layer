import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LayerError, hashtag, docs } from '../src/index.js';

/**
 * Execute error package tests.
 * @returns {void}
 */
function suite() {
  it('creates deterministic hashtag references', function hashCase() {
    const first = hashtag('@mcp-layer/manager-identity-Authorization header is required.');
    const second = hashtag('@mcp-layer/manager-identity-Authorization header is required.');
    assert.equal(first, second);
    assert.equal(first, '#87D972');
  });

  it('builds package README docs URLs from package name', function docsCase() {
    const link = docs({
      name: '@mcp-layer/manager',
      method: 'identity',
      message: 'Authorization header is required.',
      docs: 'github.com/3rd-Eden/mcp-layer/tree/main/packages',
      scope: '@mcp-layer'
    });
    assert.equal(link, 'https://github.com/3rd-Eden/mcp-layer/tree/main/packages/manager/README.md#error-87d972');
  });

  it('formats message with package and method context', function messageCase() {
    const error = new LayerError({
      name: 'manager',
      method: 'identity',
      message: 'Authorization header is required.'
    });

    assert.equal(error.name, 'LayerError');
    assert.equal(error.package, '@mcp-layer/manager');
    assert.equal(error.method, 'identity');
    assert.equal(
      error.message,
      '@mcp-layer/manager(identity): Authorization header is required.\n\nFor more information visit: https://github.com/3rd-Eden/mcp-layer/tree/main/packages/manager/README.md#error-bc38ab'
    );
    assert.equal(error.reference, '#BC38AB');
  });

  it('supports named placeholder interpolation and custom fields', function argsCase() {
    const error = new LayerError({
      name: 'manager',
      method: 'normalize',
      message: 'Invalid option "{option}" for "{target}".',
      vars: { option: 'max', target: 'createManager' },
      status: 400
    });

    assert.equal(
      error.message,
      '@mcp-layer/manager(normalize): Invalid option "max" for "createManager".\n\nFor more information visit: https://github.com/3rd-Eden/mcp-layer/tree/main/packages/manager/README.md#error-cbc070'
    );
    assert.equal(error.status, 400);
    assert.equal(error.reference, '#CBC070');
  });
}

describe('@mcp-layer/error', suite);
