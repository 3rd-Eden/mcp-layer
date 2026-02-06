import { schemas } from './schemas/index.js';
import { path, tpath } from './routing.js';

/**
 * Normalize catalog item list into a type-filtered list.
 * @param {Array<Record<string, unknown>>} items - Catalog items from @mcp-layer/schema.
 * @param {string} type - Desired item type.
 * @returns {Array<Record<string, unknown>>}
 */
function bytype(items, type) {
  /**
   * Filter catalog items by type.
   * @param {Record<string, unknown>} item - Catalog item.
   * @returns {boolean}
   */
  function istype(item) {
    return Boolean(item && item.type === type);
  }

  return items.filter(istype);
}

/**
 * Normalize OpenAPI prefix to ensure leading slash.
 * @param {string | undefined} prefix - User-supplied prefix.
 * @returns {string}
 */
function normprefix(prefix) {
  if (!prefix) return '/v1';
  if (prefix.startsWith('/')) return prefix;
  return `/${prefix}`;
}

/**
 * Select a human-friendly label for catalog items.
 *
 *
 * @param {Record<string, unknown>} item - Catalog item.
 * @param {string} fallback - Fallback label.
 * @returns {string}
 */
function label(item, fallback) {
  if (item && typeof item.title === 'string' && item.title.length > 0) return item.title;
  if (item && typeof item.name === 'string' && item.name.length > 0) return item.name;
  return fallback;
}

/**
 * Validate item names used in route paths.
 *
 *
 * @param {string} value - Name to validate.
 * @param {number | undefined} maxLength - Optional length cap.
 * @returns {void}
 */
function assertName(value, maxLength) {
  const pattern = /^[a-z0-9._-]+$/i;
  if (!pattern.test(value)) {
    throw new Error(`Item name "${value}" must be URL-safe (letters, digits, ".", "_", "-").`);
  }
  if (typeof maxLength === 'number' && value.length > maxLength) {
    throw new Error(`Item name "${value}" exceeds maximum length of ${maxLength}.`);
  }
}

/**
 * Ensure a template expression only uses simple `{name}` tokens.
 *
 *
 * @param {string} template - Template route string.
 * @returns {void}
 */
function assertSimpleTemplate(template) {
  const re = /\{([^}]+)\}/g;
  let match = re.exec(template);

  while (match) {
    const expr = match[1] ?? '';
    if (/[+#./?&*]/.test(expr) || expr.includes(',')) {
      throw new Error(`Template expression "${match[0]}" is not supported.`);
    }
    if (!/^[A-Za-z0-9._-]+$/.test(expr)) {
      throw new Error(`Template parameter "${expr}" must be URL-safe.`);
    }
    match = re.exec(template);
  }
}

/**
 * Select a description for an operation.
 *
 * from item metadata to avoid generic boilerplate.
 *
 * @param {Record<string, unknown>} item - Catalog item.
 * @param {string} verb - Verb phrase describing the action.
 * @returns {string}
 */
function desc(item, verb) {
  if (item && typeof item.description === 'string' && item.description.length > 0) return item.description;
  const name = label(item, 'operation');
  return `${verb} ${name}.`;
}

/**
 * Build request body schema for an item input.
 * @param {Record<string, unknown> | undefined} input - Input schema detail from catalog.
 * @returns {Record<string, unknown>}
 */
function inputschema(input) {
  if (input && input.json && typeof input.json === 'object') {
    return /** @type {Record<string, unknown>} */ (input.json);
  }
  return { type: 'object', additionalProperties: true };
}

/**
 * Build a default error response map.
 * @returns {Record<string, unknown>}
 */
function errorresponses() {
  return {
    '400': {
      description: 'Request validation error',
      content: {
        'application/problem+json': {
          schema: { $ref: '#/components/schemas/ProblemDetails' }
        }
      }
    },
    '503': {
      description: 'Service unavailable',
      content: {
        'application/problem+json': {
          schema: { $ref: '#/components/schemas/ProblemDetails' }
        }
      }
    },
    '504': {
      description: 'Request timeout',
      content: {
        'application/problem+json': {
          schema: { $ref: '#/components/schemas/ProblemDetails' }
        }
      }
    },
    '500': {
      description: 'Server error',
      content: {
        'application/problem+json': {
          schema: { $ref: '#/components/schemas/ProblemDetails' }
        }
      }
    }
  };
}

/**
 * Build OpenAPI path entry for an operation invocation.
 * @param {Record<string, unknown>} item - Tool item from catalog.
 * @returns {Record<string, unknown>}
 */
function toolpath(item) {
  const input = inputschema(item.detail?.input);
  const name = label(item, 'operation');
  return {
    post: {
      summary: name,
      description: desc(item, 'Invoke'),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: input
          }
        }
      },
      responses: {
        '200': {
          description: `Response payload for ${name}.`,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ToolResponse' }
            }
          }
        },
        '502': {
          description: `Execution error for ${name}.`,
          content: {
            'application/problem+json': {
              schema: { $ref: '#/components/schemas/ProblemDetails' }
            }
          }
        },
        ...errorresponses()
      }
    }
  };
}

/**
 * Build OpenAPI path entry for a prompt invocation.
 * @param {Record<string, unknown>} item - Prompt item from catalog.
 * @returns {Record<string, unknown>}
 */
function promptpath(item) {
  const input = inputschema(item.detail?.input);
  const name = label(item, 'prompt');
  return {
    post: {
      summary: name,
      description: desc(item, 'Render'),
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: input
          }
        }
      },
      responses: {
        '200': {
          description: `Response payload for ${name}.`,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PromptResponse' }
            }
          }
        },
        ...errorresponses()
      }
    }
  };
}

/**
 * Build OpenAPI path entry for a resource read.
 * @param {Record<string, unknown>} item - Resource item from catalog.
 * @returns {Record<string, unknown>}
 */
function resourcepath(item) {
  const mime = item.detail?.mimeType ? item.detail.mimeType : 'application/octet-stream';
  const name = label(item, 'resource');
  return {
    get: {
      summary: name,
      description: desc(item, 'Fetch'),
      responses: {
        '200': {
          description: `Content for ${name}.`,
          content: {
            [mime]: {
              schema: { type: 'string' }
            }
          }
        },
        ...errorresponses()
      }
    }
  };
}

/**
 * Extract path parameter definitions from a template.
 *
 * templated paths.
 *
 * @param {string} template - URI template string.
 * @returns {Array<Record<string, unknown>>}
 */
function templateparams(template) {
  const params = [];
  const seen = new Set();
  const re = /\{([^}]+)\}/g;
  let match = re.exec(template);

  while (match) {
    const expr = match[1] ?? '';
    const cleaned = expr.replace(/^[+#./?&]/, '').replace(/\*$/, '');
    const name = cleaned.split(',')[0];
    if (name && !seen.has(name)) {
      seen.add(name);
      params.push({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' }
      });
    }
    match = re.exec(template);
  }

  return params;
}
/**
 * Build OpenAPI path entry for listing resource templates.
 * @returns {Record<string, unknown>}
 */
function templatepath() {
  return {
    get: {
      summary: 'Resource templates',
      description: 'List templated resources available from this API.',
      responses: {
        '200': {
          description: 'Template list',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  templates: { type: 'array', items: { type: 'object' } }
                },
                required: ['templates']
              }
            }
          }
        },
        ...errorresponses()
      }
    }
  };
}

/**
 * Build OpenAPI path entry for the OpenAPI JSON endpoint.
 * @returns {Record<string, unknown>}
 */
function openapipath() {
  return {
    get: {
      summary: 'OpenAPI spec',
      description: 'OpenAPI 3.1 specification for this API.',
      responses: {
        '200': {
          description: 'OpenAPI document',
          content: {
            'application/json': {
              schema: { type: 'object' }
            }
          }
        }
      }
    }
  };
}

/**
 * Generate an OpenAPI 3.1 specification from a catalog.
 *
 * that can be used both by the Fastify plugin and future client generators.
 *
 * @param {{ server?: { info?: Record<string, unknown>, instructions?: string }, items?: Array<Record<string, unknown>> }} catalog - Extracted catalog from @mcp-layer/schema.
 * @param {{ title?: string, version?: string, prefix?: string, description?: string, contact?: Record<string, unknown>, license?: Record<string, unknown>, maxNameLength?: number }} [options] - Spec generation options.
 * @returns {Record<string, unknown>} OpenAPI 3.1 specification object.
 */
export function spec(catalog = {}, options = {}) {
  const info = catalog.server?.info;
  const list = Array.isArray(catalog.items) ? catalog.items : [];
  const prefix = normprefix(options.prefix);
  const maxNameLength = typeof options.maxNameLength === 'number' ? options.maxNameLength : undefined;

  const title = options.title ?? (info?.name ? String(info.name) : 'REST API');
  const version = options.version ?? (info?.version ? String(info.version) : '1.0.0');
  const desc = options.description
    ?? (info?.description ? String(info.description) : undefined)
    ?? (catalog.server?.instructions ? String(catalog.server.instructions) : undefined);

  const data = {
    openapi: '3.1.0',
    info: {
      title,
      version,
      ...(desc ? { description: desc } : {}),
      ...(options.contact ? { contact: options.contact } : {}),
      ...(options.license ? { license: options.license } : {})
    },
    paths: {},
    components: {
      schemas
    }
  };

  const tools = bytype(list, 'tool');
  for (const item of tools) {
    if (!item || !item.name) continue;
    assertName(String(item.name), maxNameLength);
    data.paths[`${prefix}/${item.name}`] = toolpath(item);
  }

  const prompts = bytype(list, 'prompt');
  for (const item of prompts) {
    if (!item || !item.name) continue;
    assertName(String(item.name), maxNameLength);
    data.paths[`${prefix}/prompts/${item.name}`] = promptpath(item);
  }

  const resources = bytype(list, 'resource');
  for (const item of resources) {
    const uri = item.detail?.uri ? String(item.detail.uri) : null;
    if (!uri) continue;
    const route = path(uri);
    data.paths[`${prefix}${route}`] = resourcepath(item);
  }

  const templates = bytype(list, 'resource-template');
  for (const item of templates) {
    const tmpl = item.detail?.uriTemplate ? String(item.detail.uriTemplate) : null;
    if (!tmpl) continue;
    const route = tpath(tmpl, false);
    assertSimpleTemplate(route);
    const entry = resourcepath(item);
    const params = templateparams(route);
    if (params.length > 0) entry.get.parameters = params;
    data.paths[`${prefix}${route}`] = entry;
  }

  data.paths[`${prefix}/resource-templates`] = templatepath();
  data.paths[`${prefix}/openapi.json`] = openapipath();

  return data;
}
