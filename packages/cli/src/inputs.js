import { readFile } from 'node:fs/promises';

/**
 * Collect tool/prompt inputs from argv.
 * @param {{ json?: string, input?: string }} opts
 * @param {Record<string, unknown>} parsed
 * @param {Record<string, unknown>} extra
 * @param {{ detail?: { input?: { json?: Record<string, unknown> } } }} item
 * @returns {Promise<Record<string, unknown>>}
 */
export async function inputs(opts, parsed, extra, item) {
  const source = Object.keys(extra).length ? extra : parsed;
  if (typeof opts.json === 'string') {
    return JSON.parse(opts.json);
  }
  if (typeof opts.input === 'string') {
    const raw = await readFile(opts.input, 'utf8');
    return JSON.parse(raw);
  }
  const schema = item.detail?.input?.json;
  const props = schema && typeof schema === 'object' && schema.properties ? schema.properties : {};
  const args = {};
  for (const name of Object.keys(props)) {
    if (Object.hasOwn(source, name)) {
      args[name] = coerce(source[name], props[name]);
    }
  }
  const required = Array.isArray(schema?.required) ? schema.required : [];
  for (const name of required) {
    if (!Object.hasOwn(args, name)) {
      throw new Error(`Missing required parameter: ${name}`);
    }
  }
  return args;
}

/**
 * Coerce CLI input values into schema-friendly shapes.
 * @param {unknown} value
 * @param {unknown} schema
 * @returns {unknown}
 */
function coerce(value, schema) {
  if (!schema || typeof schema !== 'object') {
    return value;
  }
  const type = schema.type;
  if (type === 'array' || type === 'object' || (Array.isArray(type) && (type.includes('array') || type.includes('object')))) {
    if (typeof value !== 'string') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid JSON input';
      throw new Error(`Invalid JSON for ${schema.title || schema.description || 'parameter'}: ${message}`);
    }
  }
  return value;
}
