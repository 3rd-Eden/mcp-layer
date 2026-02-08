import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { shouldTrustSchemas } from './trust.js';
import { checkSchemaSafety } from './safety.js';

/**
 * Schema validator for MCP tool and prompt inputs.
 */
export class SchemaValidator {
  /**
   * @param {{ trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }} config - Validation configuration.
   * @param {import('@mcp-layer/session').Session} session - MCP session.
   */
  constructor(config, session) {
    this.#config = config;
    this.#trusted = shouldTrustSchemas(session, config.trustSchemas);
    this.#ajv = new Ajv({
      allErrors: true,
      strict: this.#trusted ? false : 'log',
      validateFormats: true,
      coerceTypes: 'array',
      removeAdditional: true
    });
    addFormats(this.#ajv);
  }

  /**
   * Register a tool schema for validation.
   * @param {string} name - Tool name.
   * @param {Record<string, unknown> | undefined} schema - JSON Schema for input.
   * @returns {{ success: boolean, error?: string, skipped?: boolean, reason?: string }}
   */
  registerToolSchema(name, schema) {
    return this.#registerSchema(`tool:${name}`, schema);
  }

  /**
   * Register a prompt schema for validation.
   * @param {string} name - Prompt name.
   * @param {Record<string, unknown> | undefined} schema - JSON Schema for input.
   * @returns {{ success: boolean, error?: string, skipped?: boolean, reason?: string }}
   */
  registerPromptSchema(name, schema) {
    return this.#registerSchema(`prompt:${name}`, schema);
  }

  /**
   * Validate a request payload against a registered schema.
   * @param {'tool' | 'prompt'} type - Schema type.
   * @param {string} name - Tool or prompt name.
   * @param {unknown} input - Request payload.
   * @returns {{ valid: boolean, errors?: Array<{ path: string, keyword?: string, message?: string, params?: Record<string, unknown> }> }}
   */
  validate(type, name, input) {
    const key = `${type}:${name}`;
    const fn = this.#validators.get(key);

    if (fn === undefined) {
      return {
        valid: false,
        errors: [{ path: '', message: `Unknown ${type}: ${name}` }]
      };
    }

    if (fn === null) {
      return { valid: true };
    }

    const ok = fn(input);
    if (ok) {
      return { valid: true };
    }

    const errs = [];
    const list = Array.isArray(fn.errors) ? fn.errors : [];
    for (const err of list) {
      errs.push({
        path: err.instancePath || '/',
        keyword: err.keyword,
        message: err.message,
        params: err.params
      });
    }

    return { valid: false, errors: errs };
  }

  /**
   * Register and compile a schema into an Ajv validator.
   * @param {string} key - Internal map key.
   * @param {Record<string, unknown> | undefined} schema - JSON Schema.
   * @returns {{ success: boolean, error?: string, skipped?: boolean, reason?: string }}
   */
  #registerSchema(key, schema) {
    if (!schema) {
      this.#validators.set(key, null);
      return { success: true };
    }

    if (!this.#trusted) {
      const safety = checkSchemaSafety(schema, this.#config);
      if (!safety.safe) {
        this.#validators.set(key, null);
        return { success: true, skipped: true, reason: safety.reason };
      }
    }

    try {
      const fn = this.#ajv.compile(schema);
      this.#validators.set(key, fn);
      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Schema compilation failed: ${message}` };
    }
  }

  /**
   * @type {Map<string, import('ajv').ValidateFunction | null>}
   */
  #validators = new Map();

  /**
   * @type {Ajv}
   */
  #ajv;

  /**
   * @type {{ trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }}
   */
  #config;

  /**
   * @type {boolean}
   */
  #trusted;
}

/**
 * Create a schema validator instance.
 * @param {{ trustSchemas: 'auto' | true | false, maxSchemaDepth: number, maxSchemaSize: number, maxPatternLength: number, maxToolNameLength: number, maxTemplateParamLength: number }} config - Validation configuration.
 * @param {import('@mcp-layer/session').Session} session - MCP session.
 * @returns {SchemaValidator}
 */
export function createValidator(config, session) {
  return new SchemaValidator(config, session);
}
