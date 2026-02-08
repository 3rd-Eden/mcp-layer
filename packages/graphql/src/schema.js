import { makeExecutableSchema } from '@graphql-tools/schema';
import GraphQLJSON from 'graphql-type-json';
import { map } from './mapping.js';

/**
 * Build GraphQL schema options.
 * @param {{ operations?: { generated?: boolean, generic?: boolean } }} [options] - Schema options.
 * @returns {{ operations: { generated: boolean, generic: boolean } }}
 */
function normalizeOptions(options = {}) {
  const operations = options?.operations && typeof options.operations === 'object'
    ? options.operations
    : {};

  return {
    operations: {
      generated: operations.generated === undefined ? true : Boolean(operations.generated),
      generic: operations.generic === undefined ? true : Boolean(operations.generic)
    }
  };
}

/**
 * Build GraphQL field definitions for generated entries.
 * @param {ReturnType<typeof map>} mapping - Catalog map.
 * @returns {{ query: string[], mutation: string[] }}
 */
function generatedFields(mapping) {
  const query = [];
  const mutation = [];

  for (const entry of mapping.entries) {
    if (entry.type === 'tool') {
      mutation.push(`${entry.field}(input: JSON): ToolResult!`);
      continue;
    }

    if (entry.type === 'prompt') {
      mutation.push(`${entry.field}(input: JSON): PromptResult!`);
      continue;
    }

    if (entry.type === 'resource') {
      query.push(`${entry.field}: ResourceResult!`);
      continue;
    }

    if (entry.type === 'resource-template') {
      query.push(`${entry.field}(params: JSON): ResourceResult!`);
    }
  }

  return { query, mutation };
}

/**
 * Build GraphQL SDL for the adapter schema.
 * @param {ReturnType<typeof map>} mapping - Catalog map.
 * @param {{ operations: { generated: boolean, generic: boolean } }} config - Normalized config.
 * @returns {string}
 */
function buildTypeDefs(mapping, config) {
  const query = ['catalog: Catalog!'];
  const mutation = [];

  if (config.operations.generic) {
    query.push('readResource(uri: String!): ResourceResult!');
    query.push('readTemplate(uriTemplate: String!, params: JSON): ResourceResult!');
    mutation.push('callTool(name: String!, input: JSON): ToolResult!');
    mutation.push('getPrompt(name: String!, input: JSON): PromptResult!');
  }

  if (config.operations.generated) {
    const generated = generatedFields(mapping);
    query.push(...generated.query);
    mutation.push(...generated.mutation);
  }

  const lines = [
    `scalar JSON`,
    ``,
    `type ToolResult {`,
    `  content: JSON!`,
    `  isError: Boolean!`,
    `  structuredContent: JSON`,
    `}`,
    ``,
    `type PromptResult {`,
    `  messages: JSON!`,
    `  payload: JSON!`,
    `}`,
    ``,
    `type ResourceResult {`,
    `  contents: JSON!`,
    `  text: String`,
    `  mimeType: String`,
    `  payload: JSON!`,
    `}`,
    ``,
    `type CatalogEntry {`,
    `  type: String!`,
    `  name: String!`,
    `  field: String!`,
    `  root: String!`,
    `  description: String`,
    `}`,
    ``,
    `type Catalog {`,
    `  tools: [CatalogEntry!]!`,
    `  prompts: [CatalogEntry!]!`,
    `  resources: [CatalogEntry!]!`,
    `  templates: [CatalogEntry!]!`,
    `}`,
    ``,
    `type Query {`
  ];

  for (const field of query) {
    lines.push(`  ${field}`);
  }
  lines.push(`}`);

  if (mutation.length > 0) {
    lines.push(``);
    lines.push(`type Mutation {`);
    for (const field of mutation) {
      lines.push(`  ${field}`);
    }
    lines.push(`}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Build a catalog entry view model.
 * @param {{ type: string, root: 'query' | 'mutation', name: string, field: string, item: Record<string, unknown> }} source - Mapping entry.
 * @returns {{ type: string, root: string, name: string, field: string, description?: string }}
 */
function catalogEntry(source) {
  return {
    type: source.type,
    root: source.root,
    name: source.name,
    field: source.field,
    description: typeof source.item.description === 'string' ? source.item.description : undefined
  };
}

/**
 * Build catalog payload for GraphQL consumers.
 * @param {ReturnType<typeof map>} mapping - Catalog map.
 * @returns {{ tools: Array<{ type: string, root: string, name: string, field: string, description?: string }>, prompts: Array<{ type: string, root: string, name: string, field: string, description?: string }>, resources: Array<{ type: string, root: string, name: string, field: string, description?: string }>, templates: Array<{ type: string, root: string, name: string, field: string, description?: string }> }}
 */
function catalogPayload(mapping) {
  const tools = [];
  const prompts = [];
  const resources = [];
  const templates = [];

  for (const item of mapping.entries) {
    const view = catalogEntry(item);
    if (item.type === 'tool') tools.push(view);
    if (item.type === 'prompt') prompts.push(view);
    if (item.type === 'resource') resources.push(view);
    if (item.type === 'resource-template') templates.push(view);
  }

  return { tools, prompts, resources, templates };
}

/**
 * Create resolver for catalog query.
 * @param {ReturnType<typeof map>} mapping - Catalog map.
 * @returns {(root: unknown, args: unknown, context: Record<string, unknown>) => { tools: Array<{ type: string, root: string, name: string, field: string, description?: string }>, prompts: Array<{ type: string, root: string, name: string, field: string, description?: string }>, resources: Array<{ type: string, root: string, name: string, field: string, description?: string }>, templates: Array<{ type: string, root: string, name: string, field: string, description?: string }> }}
 */
function createCatalogResolver(mapping) {
  /**
   * Resolve catalog metadata.
   * @returns {{ tools: Array<{ type: string, root: string, name: string, field: string, description?: string }>, prompts: Array<{ type: string, root: string, name: string, field: string, description?: string }>, resources: Array<{ type: string, root: string, name: string, field: string, description?: string }>, templates: Array<{ type: string, root: string, name: string, field: string, description?: string }> }}
   */
  function resolve() {
    return catalogPayload(mapping);
  }

  return resolve;
}

/**
 * Create resolver for generic tool calls.
 * @returns {(root: unknown, args: { name: string, input?: Record<string, unknown> }, context: { callTool: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>> }) => Promise<Record<string, unknown>>}
 */
function genericTool() {
  /**
   * Execute generic tool operation.
   * @param {unknown} _root - GraphQL root.
   * @param {{ name: string, input?: Record<string, unknown> }} args - Resolver args.
   * @param {{ callTool: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>> }} context - Resolver context.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function resolve(_root, args, context) {
    return context.callTool(args.name, args.input ?? {});
  }

  return resolve;
}

/**
 * Create resolver for generic prompt calls.
 * @returns {(root: unknown, args: { name: string, input?: Record<string, unknown> }, context: { getPrompt: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>> }) => Promise<Record<string, unknown>>}
 */
function genericPrompt() {
  /**
   * Execute generic prompt operation.
   * @param {unknown} _root - GraphQL root.
   * @param {{ name: string, input?: Record<string, unknown> }} args - Resolver args.
   * @param {{ getPrompt: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>> }} context - Resolver context.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function resolve(_root, args, context) {
    return context.getPrompt(args.name, args.input ?? {});
  }

  return resolve;
}

/**
 * Create resolver for generic resource reads.
 * @returns {(root: unknown, args: { uri: string }, context: { readResource: (uri: string) => Promise<Record<string, unknown>> }) => Promise<Record<string, unknown>>}
 */
function genericResource() {
  /**
   * Execute generic resource read operation.
   * @param {unknown} _root - GraphQL root.
   * @param {{ uri: string }} args - Resolver args.
   * @param {{ readResource: (uri: string) => Promise<Record<string, unknown>> }} context - Resolver context.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function resolve(_root, args, context) {
    return context.readResource(args.uri);
  }

  return resolve;
}

/**
 * Create resolver for generic template reads.
 * @returns {(root: unknown, args: { uriTemplate: string, params?: Record<string, unknown> }, context: { readTemplate: (template: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> }) => Promise<Record<string, unknown>>}
 */
function genericTemplate() {
  /**
   * Execute generic template read operation.
   * @param {unknown} _root - GraphQL root.
   * @param {{ uriTemplate: string, params?: Record<string, unknown> }} args - Resolver args.
   * @param {{ readTemplate: (template: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> }} context - Resolver context.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function resolve(_root, args, context) {
    return context.readTemplate(args.uriTemplate, args.params ?? {});
  }

  return resolve;
}

/**
 * Create generated tool resolver.
 * @param {string} name - Tool name.
 * @returns {(root: unknown, args: { input?: Record<string, unknown> }, context: { callTool: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>> }) => Promise<Record<string, unknown>>}
 */
function generatedTool(name) {
  /**
   * Execute generated tool resolver.
   * @param {unknown} _root - GraphQL root.
   * @param {{ input?: Record<string, unknown> }} args - Resolver args.
   * @param {{ callTool: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>> }} context - Resolver context.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function resolve(_root, args, context) {
    return context.callTool(name, args.input ?? {});
  }

  return resolve;
}

/**
 * Create generated prompt resolver.
 * @param {string} name - Prompt name.
 * @returns {(root: unknown, args: { input?: Record<string, unknown> }, context: { getPrompt: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>> }) => Promise<Record<string, unknown>>}
 */
function generatedPrompt(name) {
  /**
   * Execute generated prompt resolver.
   * @param {unknown} _root - GraphQL root.
   * @param {{ input?: Record<string, unknown> }} args - Resolver args.
   * @param {{ getPrompt: (name: string, input: Record<string, unknown>) => Promise<Record<string, unknown>> }} context - Resolver context.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function resolve(_root, args, context) {
    return context.getPrompt(name, args.input ?? {});
  }

  return resolve;
}

/**
 * Create generated resource resolver.
 * @param {string} uri - Resource uri.
 * @returns {(root: unknown, args: unknown, context: { readResource: (uri: string) => Promise<Record<string, unknown>> }) => Promise<Record<string, unknown>>}
 */
function generatedResource(uri) {
  /**
   * Execute generated resource resolver.
   * @param {unknown} _root - GraphQL root.
   * @param {unknown} _args - Resolver args.
   * @param {{ readResource: (uri: string) => Promise<Record<string, unknown>> }} context - Resolver context.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function resolve(_root, _args, context) {
    return context.readResource(uri);
  }

  return resolve;
}

/**
 * Create generated resource template resolver.
 * @param {string} source - Resource template.
 * @returns {(root: unknown, args: { params?: Record<string, unknown> }, context: { readTemplate: (template: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> }) => Promise<Record<string, unknown>>}
 */
function generatedTemplate(source) {
  /**
   * Execute generated template resolver.
   * @param {unknown} _root - GraphQL root.
   * @param {{ params?: Record<string, unknown> }} args - Resolver args.
   * @param {{ readTemplate: (template: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> }} context - Resolver context.
   * @returns {Promise<Record<string, unknown>>}
   */
  async function resolve(_root, args, context) {
    return context.readTemplate(source, args.params ?? {});
  }

  return resolve;
}

/**
 * Build resolver map for the schema.
 * @param {ReturnType<typeof map>} mapping - Catalog map.
 * @param {{ operations: { generated: boolean, generic: boolean } }} config - Normalized config.
 * @returns {Record<string, unknown>}
 */
function buildResolvers(mapping, config) {
  const query = { catalog: createCatalogResolver(mapping) };
  const mutation = {};

  if (config.operations.generic) {
    query.readResource = genericResource();
    query.readTemplate = genericTemplate();
    mutation.callTool = genericTool();
    mutation.getPrompt = genericPrompt();
  }

  if (config.operations.generated) {
    for (const entry of mapping.entries) {
      if (entry.type === 'tool') {
        mutation[entry.field] = generatedTool(entry.name);
        continue;
      }

      if (entry.type === 'prompt') {
        mutation[entry.field] = generatedPrompt(entry.name);
        continue;
      }

      if (entry.type === 'resource') {
        const uri = entry.item.detail?.uri ? String(entry.item.detail.uri) : '';
        query[entry.field] = generatedResource(uri);
        continue;
      }

      if (entry.type === 'resource-template') {
        const source = entry.item.detail?.uriTemplate ? String(entry.item.detail.uriTemplate) : '';
        query[entry.field] = generatedTemplate(source);
      }
    }
  }

  const resolvers = {
    JSON: GraphQLJSON,
    Query: query
  };

  if (Object.keys(mutation).length > 0) {
    resolvers.Mutation = mutation;
  }

  return resolvers;
}

/**
 * Build an executable GraphQL schema from an MCP catalog.
 * @param {{ items?: Array<Record<string, unknown>> }} catalog - Extracted catalog.
 * @param {{ operations?: { generated?: boolean, generic?: boolean } }} [options] - Build options.
 * @returns {{ schema: import('graphql').GraphQLSchema, typeDefs: string, resolvers: Record<string, unknown>, mapping: ReturnType<typeof map> }}
 */
export function schema(catalog = {}, options = {}) {
  const config = normalizeOptions(options);
  const mapping = map(catalog);
  const typeDefs = buildTypeDefs(mapping, config);
  const resolvers = buildResolvers(mapping, config);
  const executable = makeExecutableSchema({ typeDefs, resolvers });

  return {
    schema: executable,
    typeDefs,
    resolvers,
    mapping
  };
}
