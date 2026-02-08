import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { map } from '../src/mapping.js';
import { schema } from '../src/schema.js';

/**
 * Build schema fixture with GraphQL-unsafe names.
 * @returns {{ items: Array<Record<string, unknown>> }}
 */
function fixture() {
  return {
    items: [
      { type: 'tool', name: 'echo', detail: {} },
      { type: 'tool', name: 'fail-gracefully', detail: {} },
      { type: 'prompt', name: 'hello-world', detail: {} },
      { type: 'resource', name: 'notes/main', detail: { uri: 'note://main' } },
      { type: 'resource-template', name: 'notes-template', detail: { uriTemplate: 'note://{name}' } }
    ]
  };
}

/**
 * Execute schema builder tests.
 * @returns {void}
 */
function suite() {
  it('creates deterministic generated mappings', function mapping() {
    const one = map(fixture());
    const two = map(fixture());

    const left = one.entries.map(function collect(entry) {
      return `${entry.type}:${entry.name}:${entry.field}`;
    });

    const right = two.entries.map(function collect(entry) {
      return `${entry.type}:${entry.name}:${entry.field}`;
    });

    assert.deepEqual(left, right);
    assert.ok(one.findField('tool', 'fail-gracefully'));
  });

  it('builds executable schema with generic and generated operations', function buildout() {
    const built = schema(fixture(), {
      operations: {
        generated: true,
        generic: true
      }
    });

    assert.ok(built.schema);
    assert.ok(built.typeDefs.includes('callTool(name: String!, input: JSON): ToolResult!'));
    assert.ok(built.typeDefs.includes('readResource(uri: String!): ResourceResult!'));
    assert.ok(built.typeDefs.includes('fail_gracefully(input: JSON): ToolResult!'));
  });
}

describe('graphql schema builder', suite);
