import { readFile } from 'node:fs/promises';
import { LayerError } from '@mcp-layer/error';

/**
 * Collect tool/prompt inputs from argv.
 * @param {{ json?: string, input?: string }} opts - CLI input flags for JSON payloads.
 * @param {Record<string, unknown>} parsed - Parsed argv for the main argument list.
 * @param {Record<string, unknown>} extra - Parsed argv for passthrough arguments.
 * @param {{ detail?: { input?: { json?: Record<string, unknown> } } }} item - Schema item describing expected inputs.
 * @returns {Promise<Record<string, unknown>>}
 */
export async function inputs(opts, parsed, extra, item) {
  const source = Object.keys(extra).length ? extra : parsed;
  if (typeof opts.json === 'string') return JSON.parse(opts.json);
  if (typeof opts.input === 'string') {
    const raw = await readFile(opts.input, 'utf8');
    return JSON.parse(raw);
  }
  const schema = item.detail?.input?.json;
  const props = schema && typeof schema === 'object' && schema.properties ? schema.properties : {};
  const args = {};
  for (const name of Object.keys(props)) {
    if (Object.hasOwn(source, name)) args[name] = coerce(source[name], props[name]);
  }
  const required = Array.isArray(schema?.required) ? schema.required : [];
  for (const name of required) {
    if (!Object.hasOwn(args, name)) {
      throw new LayerError({
        name: 'cli',
        method: 'inputs',
        message: 'Required parameter "{parameter}" is missing.',
        vars: { parameter: name }
      });
    }
  }
  return args;
}

/**
 * Coerce CLI input values into schema-friendly shapes.
 * @param {unknown} value - Raw CLI input value.
 * @param {unknown} schema - JSON schema definition for the input.
 * @returns {unknown}
 */
function coerce(value, schema) {
  if (!schema || typeof schema !== 'object') return value;
  const type = schema.type;
  if (type === 'array' || (Array.isArray(type) && type.includes('array'))) return coercearray(value, schema);
  if (type === 'object' || (Array.isArray(type) && type.includes('object'))) return coerceobject(value, schema);
  return coercevalue(value, schema);
}

/**
 * Coerce array inputs and apply item conversions.
 * @param {unknown} value - Raw CLI input value.
 * @param {Record<string, unknown>} schema - JSON schema definition for the array input.
 * @returns {unknown}
 */
function coercearray(value, schema) {
  const parsed = typeof value === 'string' ? parsejson(value, schema) : value;
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const items = schema.items && typeof schema.items === 'object' ? schema.items : {};
  return list.map(function mapItem(entry) {
    return coercevalue(entry, items);
  });
}

/**
 * Coerce object inputs, preferring JSON parsing for string values.
 * @param {unknown} value - Raw CLI input value.
 * @param {Record<string, unknown>} schema - JSON schema definition for the object input.
 * @returns {unknown}
 */
function coerceobject(value, schema) {
  if (typeof value !== 'string') return value;
  return parsejson(value, schema);
}

/**
 * Coerce scalar values based on schema type.
 * @param {unknown} value - Raw CLI input value.
 * @param {Record<string, unknown>} schema - JSON schema definition for the scalar input.
 * @returns {unknown}
 */
function coercevalue(value, schema) {
  const type = schema.type;
  if (type === 'boolean' || (Array.isArray(type) && type.includes('boolean'))) return coerceboolean(value, schema);
  if (type === 'number' || type === 'integer' || (Array.isArray(type) && (type.includes('number') || type.includes('integer')))) {
    return coercenumber(value, schema);
  }
  return value;
}

/**
 * Coerce a boolean value.
 * @param {unknown} value - Raw CLI input value.
 * @param {Record<string, unknown>} schema - JSON schema definition for the boolean input.
 * @returns {unknown}
 */
function coerceboolean(value, schema) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
  }
  return value;
}

/**
 * Coerce numeric values.
 * @param {unknown} value - Raw CLI input value.
 * @param {Record<string, unknown>} schema - JSON schema definition for the numeric input.
 * @returns {unknown}
 */
function coercenumber(value, schema) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const num = Number(value);
    if (Number.isNaN(num)) {
      const label = schema.title || schema.description || 'parameter';
      throw new LayerError({
        name: 'cli',
        method: 'coercenumber',
        message: 'Invalid number for "{parameter}": "{value}".',
        vars: { parameter: label, value }
      });
    }
    if (schema.type === 'integer' && !Number.isInteger(num)) {
      const label = schema.title || schema.description || 'parameter';
      throw new LayerError({
        name: 'cli',
        method: 'coercenumber',
        message: 'Invalid integer for "{parameter}": "{value}".',
        vars: { parameter: label, value }
      });
    }
    return num;
  }
  return value;
}

/**
 * Parse JSON input for object/array values.
 * @param {string} value - Raw string value to parse as JSON.
 * @param {Record<string, unknown>} schema - JSON schema definition for the input.
 * @returns {unknown}
 */
function parsejson(value, schema) {
  try {
    return JSON.parse(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON input';
    throw new LayerError({
      name: 'cli',
      method: 'parsejson',
      message: 'Invalid JSON for "{parameter}": {reason}',
      vars: { parameter: schema.title || schema.description || 'parameter', reason: message }
    });
  }
}
