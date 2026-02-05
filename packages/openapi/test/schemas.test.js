import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { schemas } from '../src/schemas/index.js';

/**
 * Validate the ProblemDetails schema shape.
 * @returns {void}
 */
function problemSchemaCase() {
  const schema = schemas.ProblemDetails;

  assert.equal(schema.$id, 'ProblemDetails');
  assert.equal(schema.type, 'object');
  assert.ok(schema.properties);
  assert.ok(schema.properties.type);
  assert.ok(schema.properties.title);
  assert.ok(schema.properties.status);
  assert.ok(schema.properties.detail);
  assert.deepEqual(schema.required, ['type', 'title', 'status', 'detail']);
}

/**
 * Validate the ToolResponse schema shape.
 * @returns {void}
 */
function toolSchemaCase() {
  const schema = schemas.ToolResponse;

  assert.equal(schema.$id, 'ToolResponse');
  assert.equal(schema.type, 'object');
  assert.ok(schema.properties);
  assert.ok(schema.properties.content);
  assert.deepEqual(schema.required, ['content']);
}

/**
 * Validate the PromptResponse schema shape.
 * @returns {void}
 */
function promptSchemaCase() {
  const schema = schemas.PromptResponse;

  assert.equal(schema.$id, 'PromptResponse');
  assert.equal(schema.type, 'object');
  assert.ok(schema.properties);
  assert.ok(schema.properties.messages);
}

/**
 * Execute schemas tests.
 * @returns {void}
 */
function schemasSuite() {
  it('exports ProblemDetails schema', problemSchemaCase);
  it('exports ToolResponse schema', toolSchemaCase);
  it('exports PromptResponse schema', promptSchemaCase);
}

describe('openapi shared schemas', schemasSuite);
