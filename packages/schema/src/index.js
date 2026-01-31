import Ajv from 'ajv';
import { z } from 'zod';

const ajv = new Ajv({ allErrors: true, strict: false });

/**
 * Test if a value is a plain object.
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isrecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Build a Zod refinement function backed by Ajv.
 * @param {import('ajv').Ajv} validator
 * @param {import('ajv').ValidateFunction} check
 * @returns {(value: unknown, ctx: import('zod').RefinementCtx) => void}
 */
function refiners(validator, check) {
  /**
   * Validate the value and emit Zod issues for Ajv failures.
   * @param {unknown} value
   * @param {import('zod').RefinementCtx} ctx
   * @returns {void}
   */
  function apply(value, ctx) {
    const ok = check(value);
    if (ok) {
      return;
    }
    const text = validator.errorsText(check.errors, { dataVar: 'value' });
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: text });
  }

  return apply;
}

/**
 * Wrap a JSON Schema into a Zod schema that delegates validation to Ajv.
 * @param {unknown} json
 * @returns {{ schema: import('zod').ZodTypeAny, json: Record<string, unknown> | undefined, error?: string }}
 */
function wrapschema(json) {
  if (!isrecord(json)) {
    return { schema: z.unknown(), json: undefined };
  }

  try {
    const check = ajv.compile(json);
    const refine = refiners(ajv, check);
    return { schema: z.any().superRefine(refine), json };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { schema: z.unknown(), json, error: message };
  }
}

/**
 * Read all pages for a list request until pagination completes.
 * @template T
 * @param {(cursor?: string) => Promise<T & { nextCursor?: string }>} call
 * @param {(result: T) => Array<unknown>} pull
 * @returns {Promise<Array<unknown>>}
 */
async function page(call, pull) {
  let cursor;
  const list = [];

  while (true) {
    const result = await call(cursor);
    const batch = pull(result);
    if (Array.isArray(batch)) {
      list.push(...batch);
    }
    cursor = result.nextCursor;
    if (!cursor) {
      break;
    }
  }

  return list;
}

/**
 * Extract tool entries from a client.
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function tools(client) {
  /**
   * Fetch a page of tools.
   * @param {string | undefined} cursor
   * @returns {Promise<{ tools: Array<Record<string, unknown>>, nextCursor?: string }>}
   */
  async function call(cursor) {
    if (cursor) {
      return client.listTools({ cursor });
    }
    return client.listTools();
  }

  /**
   * Pluck tool definitions from a list response.
   * @param {{ tools?: Array<Record<string, unknown>> }} result
   * @returns {Array<Record<string, unknown>>}
   */
  function pull(result) {
    return Array.isArray(result.tools) ? result.tools : [];
  }

  return page(call, pull);
}

/**
 * Extract resource entries from a client.
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function resources(client) {
  /**
   * Fetch a page of resources.
   * @param {string | undefined} cursor
   * @returns {Promise<{ resources: Array<Record<string, unknown>>, nextCursor?: string }>}
   */
  async function call(cursor) {
    if (cursor) {
      return client.listResources({ cursor });
    }
    return client.listResources();
  }

  /**
   * Pluck resource definitions from a list response.
   * @param {{ resources?: Array<Record<string, unknown>> }} result
   * @returns {Array<Record<string, unknown>>}
   */
  function pull(result) {
    return Array.isArray(result.resources) ? result.resources : [];
  }

  return page(call, pull);
}

/**
 * Extract resource template entries from a client.
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function templates(client) {
  /**
   * Fetch a page of resource templates.
   * @param {string | undefined} cursor
   * @returns {Promise<{ resourceTemplates: Array<Record<string, unknown>>, nextCursor?: string }>}
   */
  async function call(cursor) {
    if (cursor) {
      return client.listResourceTemplates({ cursor });
    }
    return client.listResourceTemplates();
  }

  /**
   * Pluck resource template definitions from a list response.
   * @param {{ resourceTemplates?: Array<Record<string, unknown>> }} result
   * @returns {Array<Record<string, unknown>>}
   */
  function pull(result) {
    return Array.isArray(result.resourceTemplates) ? result.resourceTemplates : [];
  }

  return page(call, pull);
}

/**
 * Extract prompt entries from a client.
 * @param {import('@modelcontextprotocol/sdk/client/index.js').Client} client
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
async function prompts(client) {
  /**
   * Fetch a page of prompts.
   * @param {string | undefined} cursor
   * @returns {Promise<{ prompts: Array<Record<string, unknown>>, nextCursor?: string }>}
   */
  async function call(cursor) {
    if (cursor) {
      return client.listPrompts({ cursor });
    }
    return client.listPrompts();
  }

  /**
   * Pluck prompt definitions from a list response.
   * @param {{ prompts?: Array<Record<string, unknown>> }} result
   * @returns {Array<Record<string, unknown>>}
   */
  function pull(result) {
    return Array.isArray(result.prompts) ? result.prompts : [];
  }

  return page(call, pull);
}

/**
 * Build shared metadata from an MCP item.
 * @param {Record<string, unknown>} item
 * @returns {Record<string, unknown>}
 */
function meta(item) {
  const out = {};
  if (Array.isArray(item.icons)) {
    out.icons = item.icons;
  }
  if (isrecord(item._meta)) {
    out._meta = item._meta;
  }
  return out;
}

/**
 * Build metadata for tools, including annotations.
 * @param {Record<string, unknown>} tool
 * @returns {Record<string, unknown>}
 */
function toolmeta(tool) {
  const out = meta(tool);
  if (isrecord(tool.annotations)) {
    out.annotations = tool.annotations;
  }
  return out;
}

/**
 * Derive a display title with tool annotation fallback.
 * @param {Record<string, unknown>} tool
 * @returns {string | undefined}
 */
function tooltitle(tool) {
  if (typeof tool.title === 'string') {
    return tool.title;
  }
  if (isrecord(tool.annotations) && typeof tool.annotations.title === 'string') {
    return tool.annotations.title;
  }
  return undefined;
}

/**
 * Extract MCP Apps UI metadata from an item.
 * @param {Record<string, unknown>} item
 * @returns {Record<string, unknown> | undefined}
 */
function uiitem(item) {
  if (!isrecord(item._meta)) {
    return undefined;
  }
  if (!isrecord(item._meta.ui)) {
    return undefined;
  }
  const ui = /** @type {Record<string, unknown>} */ (item._meta.ui);
  const out = {};
  if (typeof ui.resourceUri === 'string') {
    out.resourceUri = ui.resourceUri;
  }
  if (typeof ui.csp === 'string') {
    out.csp = ui.csp;
  }
  if (Array.isArray(ui.permissions)) {
    out.permissions = ui.permissions;
  }
  if (Object.keys(out).length === 0) {
    return undefined;
  }
  return out;
}

/**
 * Normalize a tool definition into the unified schema.
 * @param {Record<string, unknown>} tool
 * @returns {Record<string, unknown>}
 */
function toolitem(tool) {
  const input = wrapschema(tool.inputSchema);
  const output = wrapschema(tool.outputSchema);
  const detail = { input };
  const ui = uiitem(tool);

  if (isrecord(tool.outputSchema)) {
    detail.output = output;
  }
  if (ui) {
    detail.ui = ui;
  }

  return {
    type: 'tool',
    name: typeof tool.name === 'string' ? tool.name : 'tool',
    title: tooltitle(tool),
    description: typeof tool.description === 'string' ? tool.description : undefined,
    meta: toolmeta(tool),
    detail
  };
}

/**
 * Normalize a resource definition into the unified schema.
 * @param {Record<string, unknown>} resource
 * @returns {Record<string, unknown>}
 */
function resourceitem(resource) {
  const ui = uiitem(resource);
  return {
    type: 'resource',
    name: typeof resource.name === 'string' ? resource.name : 'resource',
    title: typeof resource.title === 'string' ? resource.title : undefined,
    description: typeof resource.description === 'string' ? resource.description : undefined,
    meta: meta(resource),
    detail: {
      uri: typeof resource.uri === 'string' ? resource.uri : undefined,
      mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : undefined,
      size: typeof resource.size === 'number' ? resource.size : undefined,
      ui
    }
  };
}

/**
 * Normalize a resource template definition into the unified schema.
 * @param {Record<string, unknown>} template
 * @returns {Record<string, unknown>}
 */
function templateitem(template) {
  return {
    type: 'resource-template',
    name: typeof template.name === 'string' ? template.name : 'resource-template',
    title: typeof template.title === 'string' ? template.title : undefined,
    description: typeof template.description === 'string' ? template.description : undefined,
    meta: meta(template),
    detail: {
      uriTemplate: typeof template.uriTemplate === 'string' ? template.uriTemplate : undefined,
      mimeType: typeof template.mimeType === 'string' ? template.mimeType : undefined
    }
  };
}

/**
 * Normalize a prompt definition into the unified schema.
 * @param {Record<string, unknown>} prompt
 * @returns {Record<string, unknown>}
 */
function promptitem(prompt) {
  return {
    type: 'prompt',
    name: typeof prompt.name === 'string' ? prompt.name : 'prompt',
    title: typeof prompt.title === 'string' ? prompt.title : undefined,
    description: typeof prompt.description === 'string' ? prompt.description : undefined,
    meta: meta(prompt),
    detail: {
      arguments: Array.isArray(prompt.arguments) ? prompt.arguments : []
    }
  };
}

/**
 * Convert a set of MCP definitions into a unified item list.
 * @param {{ tools?: Array<Record<string, unknown>>, resources?: Array<Record<string, unknown>>, templates?: Array<Record<string, unknown>>, prompts?: Array<Record<string, unknown>> }} data
 * @returns {Array<Record<string, unknown>>}
 */
function normalize(data) {
  const list = [];

  if (Array.isArray(data.tools)) {
    for (const item of data.tools) {
      list.push(toolitem(item));
    }
  }

  if (Array.isArray(data.resources)) {
    for (const item of data.resources) {
      list.push(resourceitem(item));
    }
  }

  if (Array.isArray(data.templates)) {
    for (const item of data.templates) {
      list.push(templateitem(item));
    }
  }

  if (Array.isArray(data.prompts)) {
    for (const item of data.prompts) {
      list.push(promptitem(item));
    }
  }

  return list;
}

/**
 * Extract MCP tool/resource/prompt schemas into a unified Zod-backed format.
 * @param {import('@mcp-layer/connect').Link} link
 * @returns {Promise<{ server: { info: Record<string, unknown> | undefined, capabilities: Record<string, unknown> | undefined, instructions: string | undefined }, items: Array<Record<string, unknown>> }>}
 */
export async function extract(link) {
  if (!link || !link.client) {
    throw new Error('Expected a Link instance from @mcp-layer/connect.');
  }

  const client = link.client;
  const caps = client.getServerCapabilities();
  const info = client.getServerVersion();
  const instructions = client.getInstructions();

  const data = {
    tools: undefined,
    resources: undefined,
    templates: undefined,
    prompts: undefined
  };

  if (caps && caps.tools) {
    data.tools = await tools(client);
  }

  if (caps && caps.resources) {
    data.resources = await resources(client);
    data.templates = await templates(client);
  }

  if (caps && caps.prompts) {
    data.prompts = await prompts(client);
  }

  const items = normalize(data);

  return {
    server: {
      info,
      capabilities: caps,
      instructions
    },
    items
  };
}
