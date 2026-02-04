import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectCandidates, findConnector } from './connectors/index.js';
import { extractServers } from './schema.js';

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
   * @param {string} name - Server name to look up.
   * @returns {{ name: string, source: string, config: Record<string, unknown> } | undefined}
   */
  get(name) {
    return this.map.get(name);
  }

  /**
   * Register an individual server if it was not seen before.
   * @param {string} name - Server name to register.
   * @param {Record<string, unknown>} config - Server connection configuration.
   * @param {string} file - Source file path for the server definition.
   * @param {string | undefined} connector - Connector name that supplied the server.
   * @param {boolean} [force] - Whether to overwrite an existing entry with the same name.
   * @returns {void}
   */
  registerServer(name, config, file, connector, force = false) {
    if (!this.map.has(name) || force) {
      this.map.set(name, { name, source: file, connector, config });
    }
  }

  /**
   * Register every server exposed by a connector.
   * @param {Array<{ name: string, config: Record<string, unknown> }>} servers - Server definitions to register.
   * @param {string} file - Source file path for the server definitions.
   * @param {string | undefined} connector - Connector name that supplied the servers.
   * @param {boolean} [force] - Whether to overwrite existing entries with the same name.
   * @returns {void}
   */
  registerServers(servers, file, connector, force = false) {
    for (const entry of servers) {
      this.registerServer(entry.name, entry.config, file, connector, force);
    }
  }

  /**
   * Consume a candidate configuration file.
   * @param {{ path: string, connector?: string, scope?: 'project' | 'home', parse?: (raw: string, file: string) => { servers: Array<{ name: string, config: Record<string, unknown> }>, metadata?: Record<string, unknown> }, data?: { servers: Array<{ name: string, config: Record<string, unknown> }>, metadata?: Record<string, unknown> } }} candidate - Parsed or raw configuration candidate to ingest.
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
      if (candidate.connector) {
        existing.connector = candidate.connector;
      }
      if (candidate.scope) {
        existing.scope = candidate.scope;
      }
      existing.data = { servers, metadata };
    } else {
      this.list.push({ path: candidate.path, connector: candidate.connector, scope: candidate.scope, data: { servers, metadata } });
    }
    this.registerServers(servers, candidate.path, candidate.connector);
  }

  /**
   * Upsert a server definition into the underlying configuration files.
   * @param {{ name: string, config: Record<string, unknown> }} entry - Server definition to upsert.
   * @param {{ connector?: string, file?: string, scope?: 'project' | 'home', metadata?: Record<string, unknown> }} [options] - Connector/file selection and metadata overrides.
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

    let file = typeof options.file === 'string' ? options.file : existing?.source;
    if (!file) {
      const matches = this.list.filter(function locateByConnector(item) {
        return item.connector === connectorName;
      });
      if (typeof options.scope === 'string') {
        const scoped = matches.find(function byScope(item) {
          return item.scope === options.scope;
        });
        file = scoped?.path ?? (matches.length > 0 ? matches[0].path : undefined);
      } else if (matches.length > 0) {
        file = matches[0].path;
      }
    }
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
      listEntry.connector = connectorName;
      listEntry.data = { servers: parsed.servers, metadata: parsed.metadata ?? {} };
    } else {
      this.list.push({ path: file, connector: connectorName, scope: options.scope, data: { servers: parsed.servers, metadata: parsed.metadata ?? {} } });
    }
  }

  /**
   * Remove a server definition from the underlying configuration file.
   * @param {string} name - Server name to remove.
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
      entry.connector = connectorName;
      entry.data = { servers: doc.servers, metadata: doc.metadata ?? {} };
    }
  }
}

/**
 * Determine runtime context for discovery.
 * @param {{ start?: string, homeDir?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} opts - Optional overrides for discovery context.
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
 * @param {string} file - File path to check.
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
 * @param {{ start?: string, homeDir?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform }} [opts] - Optional overrides for discovery context.
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
 * @param {Record<string, unknown> | undefined} document - Optional inline configuration object.
 * @param {{ start?: string, homeDir?: string, env?: NodeJS.ProcessEnv, platform?: NodeJS.Platform, documents?: Array<{ path: string, data: { servers: Array<{ name: string, config: Record<string, unknown> }>, metadata?: Record<string, unknown> } }>, connector?: string }} [opts] - Optional discovery overrides and connector metadata.
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
    await config.consume({ ...item, connector: item.source?.connector, scope: item.source?.scope });
  }

  return config;
}

/**
 * Parse an inline configuration document using the standard MCP schema.
 * @param {Record<string, unknown>} doc - Inline config object to validate and normalize.
 * @returns {{ servers: Array<{ name: string, config: Record<string, unknown> }>, metadata: Record<string, unknown> }}
 */
function parseInlineDocument(doc) {
  const parsed = extractServers(doc, '<inline>');
  if (parsed.servers.length === 0) {
    throw new Error('Inline configuration must declare at least one server using "mcpServers", "servers", or top-level objects with connection settings');
  }
  return parsed;
}
