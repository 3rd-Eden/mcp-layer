import { path, tpath } from '@mcp-layer/openapi';
import { LayerError } from '@mcp-layer/error';
import { validateSegmentName, validateToolName } from './reserved.js';
import { tool } from '../handlers/tools.js';
import { prompt } from '../handlers/prompts.js';
import { resource, template } from '../handlers/resources.js';

/**
 * Filter catalog items by type.
 * @param {Array<Record<string, unknown>>} items - Catalog items.
 * @param {string} type - Desired type.
 * @returns {Array<Record<string, unknown>>}
 */
function bytype(items, type) {
  const list = [];
  for (const item of items) {
    if (item && item.type === type) list.push(item);
  }
  return list;
}

/**
 * Convert a template path into a Fastify route pattern.
 *
 *
 * @param {string} template - Path with `{param}` tokens.
 * @returns {string}
 */
function toFastifyPath(template) {
  /**
   * Replace a template expression with Fastify param syntax.
   * @param {string} match - Full template expression.
   * @param {string} expr - Expression contents.
   * @returns {string}
   */
  function replace(match, expr) {
    if (/[+#./?&*]/.test(expr) || expr.includes(',')) {
      throw new LayerError({
        name: 'rest',
        method: 'toFastifyPath',
        message: 'Template expression "{expression}" is not supported.',
        vars: { expression: match }
      });
    }
    if (!/^[A-Za-z0-9._-]+$/.test(expr)) {
      throw new LayerError({
        name: 'rest',
        method: 'toFastifyPath',
        message: 'Template parameter "{parameter}" must be URL-safe.',
        vars: { parameter: expr }
      });
    }
    const cleaned = expr.replace(/^[+#./?&]/, '').replace(/\*$/, '');
    const name = cleaned.split(',')[0];
    if (!name) {
      throw new LayerError({
        name: 'rest',
        method: 'toFastifyPath',
        message: 'Invalid template expression "{expression}" in template "{template}".',
        vars: { expression: match, template }
      });
    }
    return `:${name}`;
  }

  return template.replace(/\{([^}]+)\}/g, replace);
}

/**
 * Extract the first path segment from a route.
 *
 *
 * @param {string} route - Route path.
 * @returns {string | null}
 */
function firstSegment(route) {
  const list = route.split('/');
  for (const part of list) {
    if (part.length > 0) return part.toLowerCase();
  }
  return null;
}

/**
 * Register REST routes for a catalog.
 *
 *
 * @param {import('fastify').FastifyInstance} fastify - Fastify instance.
 * @param {{ session: import('@mcp-layer/session').Session, catalog: { items: Array<Record<string, unknown>> }, validator: import('../validation/validator.js').SchemaValidator, resolve: (request: import('fastify').FastifyRequest) => Promise<{ session: import('@mcp-layer/session').Session, breaker: import('opossum') | null }>, telemetry: ReturnType<import('../telemetry/index.js').createTelemetry>, normalize: (error: Error & { code?: string | number }, instance: string, requestId?: string) => unknown, errors: { exposeDetails: boolean }, validation: { maxToolNameLength: number, maxTemplateParamLength: number } }} ctx - Route context.
 * @returns {Promise<void>}
 */
export async function registerRoutes(fastify, ctx) {
  const items = Array.isArray(ctx.catalog.items) ? ctx.catalog.items : [];
  const extraReserved = new Set();

  const templates = bytype(items, 'resource-template');
  for (const item of templates) {
    const tmpl = item.detail?.uriTemplate ? String(item.detail.uriTemplate) : null;
    if (!tmpl) continue;
    const route = tpath(tmpl, false);
    const segment = firstSegment(route);
    if (segment) extraReserved.add(segment);
  }

  const tools = bytype(items, 'tool');
  for (const item of tools) {
    if (!item.name) continue;
    validateToolName(String(item.name), extraReserved, { maxToolNameLength: ctx.validation.maxToolNameLength });
    const handler = tool(
      ctx.resolve,
      String(item.name),
      ctx.validator,
      ctx.telemetry,
      ctx.normalize,
      ctx.errors
    );
    fastify.post(`/${item.name}`, handler);
  }

  const prompts = bytype(items, 'prompt');
  for (const item of prompts) {
    if (!item.name) continue;
    validateSegmentName(String(item.name), { maxToolNameLength: ctx.validation.maxToolNameLength });
    const handler = prompt(
      ctx.resolve,
      String(item.name),
      ctx.validator,
      ctx.telemetry,
      ctx.normalize,
      ctx.errors
    );
    fastify.post(`/prompts/${item.name}`, handler);
  }

  const resources = bytype(items, 'resource');
  for (const item of resources) {
    const uri = item.detail?.uri ? String(item.detail.uri) : null;
    if (!uri) continue;
    const route = path(uri);
    const handler = resource(ctx.resolve, uri, ctx.telemetry, ctx.normalize, ctx.errors);
    fastify.get(route, handler);
  }

  for (const item of templates) {
    const tmpl = item.detail?.uriTemplate ? String(item.detail.uriTemplate) : null;
    if (!tmpl) continue;
    const route = tpath(tmpl, false);
    const fastifyRoute = toFastifyPath(route);
    const handler = template(
      ctx.resolve,
      tmpl,
      ctx.validation,
      ctx.telemetry,
      ctx.normalize,
      ctx.errors
    );
    fastify.get(fastifyRoute, handler);
  }

  /**
   * Handle resource template list requests.
   * @param {import('fastify').FastifyRequest} request - Fastify request.
   * @param {import('fastify').FastifyReply} reply - Fastify reply.
   * @returns {Promise<void>}
   */
  async function listTemplates(request, reply) {
    reply.code(200).send({ templates });
  }

  fastify.get('/resource-templates', listTemplates);
}
