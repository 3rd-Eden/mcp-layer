import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMap } from '../src/map.js';

/**
 * Build a catalog fixture with intentional naming collisions.
 * @returns {{ items: Array<Record<string, unknown>> }}
 */
function catalogFixture() {
  return {
    items: [
      { type: 'tool', name: 'echo' },
      { type: 'tool', name: 'echo!' },
      { type: 'tool', name: '2echo' },
      { type: 'prompt', name: 'echo' },
      { type: 'resource', name: 'notes/main', detail: { uri: 'note://main' } },
      { type: 'resource-template', name: 'note-template', detail: { uriTemplate: 'note://{name}' } }
    ]
  };
}

/**
 * Execute map tests.
 * @returns {void}
 */
function mapSuite() {
  it('generates deterministic unique field names', function deterministicCase() {
    const one = createMap(catalogFixture());
    const two = createMap(catalogFixture());

    const first = one.entries.map(function collect(entry) {
      return `${entry.type}:${entry.name}:${entry.field}`;
    });

    const second = two.entries.map(function collect(entry) {
      return `${entry.type}:${entry.name}:${entry.field}`;
    });

    assert.deepEqual(first, second);
  });

  it('provides stable item and field lookups', function lookupCase() {
    const mapping = createMap(catalogFixture());

    assert.equal(mapping.find('tool', 'echo')?.name, 'echo');
    assert.ok(mapping.findField('tool', 'echo'));
    assert.equal(mapping.find('resource', 'missing'), undefined);
  });

  it('reserves generic operation names to avoid collisions', function reservedCase() {
    const mapping = createMap({
      items: [
        { type: 'tool', name: 'callTool' },
        { type: 'prompt', name: 'getPrompt' },
        { type: 'resource', name: 'catalog', detail: { uri: 'note://catalog' } }
      ]
    });

    const fields = mapping.entries.map(function collect(entry) {
      return entry.field;
    });

    assert.equal(fields.includes('callTool'), false);
    assert.equal(fields.includes('getPrompt'), false);
    assert.equal(fields.includes('catalog'), false);
  });
}

describe('gateway map', mapSuite);
