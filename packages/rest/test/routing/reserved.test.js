import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateSegmentName, validateToolName } from '../../src/routing/reserved.js';

/**
 * Execute reserved path tests.
 * @returns {void}
 */
function reservedSuite() {
  it('rejects reserved tool names', async function reservedCase() {
    await assert.rejects(
      async function run() {
        validateToolName('prompts', new Set(), { maxToolNameLength: 64 });
      },
      /reserved/i
    );
  });

  it('rejects extra reserved names', async function extraCase() {
    const extra = new Set(['template']);
    await assert.rejects(
      async function run() {
        validateToolName('template', extra, { maxToolNameLength: 64 });
      },
      /reserved/i
    );
  });

  it('allows non-reserved tool names', function allowedCase() {
    validateToolName('echo', new Set(), { maxToolNameLength: 64 });
  });

  it('allows reserved words when only segment validation is required', function segmentCase() {
    validateSegmentName('prompts', { maxToolNameLength: 64 });
  });

  it('rejects tool names with invalid characters', async function invalidCharCase() {
    await assert.rejects(
      async function run() {
        validateToolName('echo/tool', new Set(), { maxToolNameLength: 64 });
      },
      /url-safe/i
    );
  });

  it('rejects overly long tool names', async function lengthCase() {
    const name = 'a'.repeat(65);
    await assert.rejects(
      async function run() {
        validateToolName(name, new Set(), { maxToolNameLength: 64 });
      },
      /maximum length/i
    );
  });
}

describe('reserved tool names', reservedSuite);
