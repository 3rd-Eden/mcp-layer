import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectCandidates, findConnector } from './connectors/index.js';

/**
 * Aggregate configuration data discovered on disk.
 * @class
 */
export class Config {
  constructor() {
    this.list = [];
    this.map = new Map();
  }

  /**
   * Retrieve a server definition by name.
   * @param {string} name
   * @returns {{ name: string, source: string, config: Record<string, unknown> } | undefined}
   */
  get(name) {
    return this.map.get(name);
  }

  /**
   * Register an individual server if it was not seen before.
   * @param {string} name
   * @param {Record<string, unknown>} config
   * @param {string} file
   * @param {string | undefined} connector
   * @param {boolean} [force]
   * @returns {void}
   */
  registerServer(name, config, file, connector, force = false) {
    if (!this.map.has(name) || force) {
      this.map.set(name, { name, source: file, connector, config });
    }
  }

  /**
   * Register every server exposed by a connector.
   * @param {Array<{ name: string, config: Record<string, unknown> }>} servers
   * @param {string} file
   * @param {string | undefined} connector
   * @param {boolean} [force]
   * @returns {void}
   */
  registerServers(servers, file, connector, force = false) {
    for (const entry of servers) {
      this.registerServer(entry.name, entry.config, file, connector, force);
    }
  }

  /**
   * Consume a candidate configuration file.
   * @param {{ path: string, connector?: string, parse?: (raw: string, file: string) => { servers: Array<{ name: string, config: Record<string, unknown> }>, metadata?: Record<string, unknown> }, data?: { servers: Array<{ name: string, config: Record<string, unknown> }>, metadata?: Record<string, unknown> } }} candidate
   * @returns {Promise<void>}
   */
  async consume(candidate) {
    let servers = [];
    let metadata = {};

    if (candidate.data && typeof candidate.data === 'object') {
      servers = Array.isArray(candidate.data.servers) ? candidate.data.servers : [];
      metadata = candidate.data.metadata && typeof candidate.data.metadata === 'object'
        ? candidate.data.metadata
        : {};
    } else if (typeof candidate.parse === 'function') {
      const raw = await fs.readFile(candidate.path, 'utf8');
      const parsed = candidate.parse(raw, candidate.path);
      servers = Array.isArray(parsed.servers) ? parsed.servers : [];
      metadata = parsed && typeof parsed === 'object' && parsed.metadata && typeof parsed.metadata === 'object'
        ? parsed.metadata
        : {};
    } else {
      throw new Error(`No parser or data supplied for ${candidate.path}`);
    }

    const existing = this.list.find(function match(entry) {
      return entry.path === candidate.path;
    });
    if (existing) {
      existing.data = { servers, metadata };
    } else {
      this.list.push({ path: candidate.path, data: { servers, metadata } });
    }
    this.registerServers(servers, candidate.path, candidate.connector);
  }

  /**
   * Upsert a server definition into the underlying configuration files.
   * @param {{ name: string, config: Record<string, unknown> }} entry
   * @param {{ connector?: string, file?: string, metadata?: Record<string, unknown> }} [options]
   * @returns {Promise<void>}
   */
  async add(entry, options = {}) {
    const existing = this.get(entry.name);
    const connectorName = typeof options.connector === 'string' ? options.connector : existing?.connector;
    if (!connectorName) {
      throw new Error(`Connector is required to add server "${entry.name}"`);
    }

    const connector = findConnector(connectorName);
    if (!connector || typeof connector.write !== 'function') {
      throw new Error(`Connector "${connectorName}" does not support write operations`);
    }

    const file = typeof options.file === 'string' ? options.file : existing?.source;
    if (!file) {
      throw new Error(`File path is required to add server "${entry.name}"`);
    }

    await connector.write(file, entry, options.metadata);

    const parsed = connector.parse(await fs.readFile(file, 'utf8'), file);
    this.registerServers(parsed.servers, file, connectorName, true);
    const listEntry = this.list.find(function findByPath(item) {
      return item.path === file;
    });
    if (listEntry) {
      listEntry.data = { servers: parsed.servers, metadata: parsed.metadata ?? {} };
    } else {
      this.list.push({ path: file, data: { servers: parsed.servers, metadata: parsed.metadata ?? {} } });
    }
  }

  /**
   * Remove a server definition from the underlying configuration file.
   * @param {string} name
   * @returns {Promise<void>}
   */
  async remove(name) {
    const existing = this.get(name);
    if (!existing) {
      return;
    }
    const connectorName = existing.connector;
    const connector = connectorName ? findConnector(connectorName) : undefined;
    if (!connector || typeof connector.write !== 'function') {
      throw new Error(`Connector "${connectorName ?? 'unknown'}" does not support write operations`);
    }

    const file = existing.source;
    const raw = await fs.readFile(file, 'utf8');
    const parsed = connector.parse(raw, file);
    const remaining = parsed.servers.filter(function filter(entry) {
      return entry.name !== name;
    });

    if (remaining.length === parsed.servers.length) {
      return;
    }

    const metadata = parsed.metadata && typeof parsed.metadata === 'object'
      ? { ...parsed.metadata }
      : {};

    await connector.write(file, null, { ...metadata, servers: remaining });

    this.map.delete(name);
    const doc = connector.parse(await fs.readFile(file, 'utf8'), file);
    this.registerServers(doc.servers, file, connectorName, true);
    const entry = this.list.find(function findByPath(item) {
      return item.path === file;
    });
    if (entry) {
      entry.data = { servers: doc.servers, metadata: doc.metadata ?? {} };
    }
  }
}

/**
 * Determine runtime context for discovery.
 * @param {{ start?: string, homeDir?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} opts
 * @returns {{ cwd: string, home?: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform }}
 */
function context(opts) {
  const cwd = typeof opts.start === 'string' ? opts.start : process.cwd();
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const home = opts.homeDir ?? os.homedir();
  return { cwd: path.resolve(cwd), env, platform, home };
}

/**
 * Check existence of a file path.
 * @param {string} file
 * @returns {Promise<boolean>}
 */
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve config files by traversing connector definitions.
 * @param {{ start?: string, homeDir?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [opts]
 * @returns {Promise<Array<{ path: string, parse: (raw: string, file: string) => { servers: Array<{ name: string, config: Record<string, unknown> }>, metadata?: Record<string, unknown> }, source: { connector: string, scope: 'project' | 'home' } }>>}
 */
export async function locate(opts = {}) {
  const ctx = context(opts);
  const candidates = collectCandidates(ctx);
  const seen = new Set();
  const hits = [];

  for (const candidate of candidates) {
    const ref = path.resolve(candidate.path);
    if (seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    if (await exists(ref)) {
      hits.push({ path: ref, parse: candidate.parse, source: candidate.source });
    }
  }

  return hits;
}

/**
 * Load MCP server definitions from disk.
 * @param {{ start?: string, homeDir?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, documents?: Array<{ path: string, data: { servers: Array<{ name: string, config: Record<string, unknown> }>, metadata?: Record<string, unknown> } }> }} [opts]
 * @returns {Promise<Config>}
 */
export async function load(document, opts = {}) {
  const options = typeof opts === 'string' ? { start: opts } : (opts ?? {});
  const config = new Config();

  if (document && typeof document === 'object') {
    const inline = parseInlineDocument(document);
    const inlinePath = typeof options.start === 'string' ? options.start : '<inline>';
    await config.consume({ path: inlinePath, data: inline, connector: options.connector });
    return config;
  }

  const candidates = await locate(options);

  for (const item of candidates) {
    await config.consume({ ...item, connector: item.source?.connector });
  }

  return config;
}

/**
 * Parse an inline configuration document using the standard MCP schema.
 * @param {Record<string, unknown>} doc
 * @returns {{ servers: Array<{ name: string, config: Record<string, unknown> }>, metadata: Record<string, unknown> }}
 */
function parseInlineDocument(doc) {
  const serversNode = doc && typeof doc === 'object' ? doc.mcpServers : undefined;
  if (!serversNode || typeof serversNode !== 'object') {
    throw new Error('Inline configuration must include a "mcpServers" object');
  }

  const servers = [];
  for (const [name, value] of Object.entries(serversNode)) {
    if (!value || typeof value !== 'object') {
      continue;
    }
    servers.push({ name, config: /** @type {Record<string, unknown>} */ (value) });
  }

  const metadata = {};
  if (Array.isArray(doc.inputs)) {
    metadata.inputs = doc.inputs;
  }
  if (typeof doc.defaultMode === 'string') {
    metadata.defaultMode = doc.defaultMode;
  }

  return { servers, metadata };
}
