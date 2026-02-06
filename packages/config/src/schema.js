import { promises as fs } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { LayerError } from '@mcp-layer/error';

/**
 * Determine whether the provided value represents a usable MCP server definition.
 * @param {unknown} value - Value to evaluate as a server config object.
 * @returns {value is Record<string, unknown>}
 */
function isServerConfig(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Check that a server definition exposes a connection primitive.
 * @param {Record<string, unknown>} config - Server config object to inspect.
 * @returns {boolean}
 */
function hasConnection(config) {
  const command = config.command;
  const url = config.url;
  const endpoint = config.endpoint;
  return (typeof command === 'string' && command.length > 0)
    || (typeof url === 'string' && url.length > 0)
    || (typeof endpoint === 'string' && endpoint.length > 0);
}

/**
 * Extract server entries from the standard MCP schema.
 * @param {Record<string, unknown>} doc - Parsed document to extract servers from.
 * @param {string} file - File path used for error reporting.
 * @returns {{ servers: Array<{ name: string, config: Record<string, unknown> }>, metadata: Record<string, unknown> }}
 */
export function extractServers(doc, file) {
  if (!doc || typeof doc !== 'object') {
    throw new LayerError({
      name: 'config',
      method: 'extractServers',
      message: 'Configuration document "{file}" must contain an object with server definitions.',
      vars: { file }
    });
  }

  const servers = [];

  /**
   * @param {Record<string, unknown>} node - Node containing named server configs.
   * @param {boolean} strict - Whether to enforce connection fields on every entry.
   */
  function consume(node, strict) {
    for (const [name, value] of Object.entries(node)) {
      if (!isServerConfig(value)) continue;

      if (!hasConnection(value)) {
        if (strict) {
          throw new LayerError({
            name: 'config',
            method: 'extractServers',
            message: 'Server "{server}" in "{file}" must declare "command", "url", or "endpoint".',
            vars: { server: name, file }
          });
        }
        continue;
      }

      servers.push({ name, config: /** @type {Record<string, unknown>} */ (value) });
    }
  }

  if (doc.mcpServers && typeof doc.mcpServers === 'object') {
    consume(/** @type {Record<string, unknown>} */ (doc.mcpServers), true);
  } else if (doc.servers && typeof doc.servers === 'object') {
    consume(/** @type {Record<string, unknown>} */ (doc.servers), true);
  } else {
    consume(/** @type {Record<string, unknown>} */ (doc), false);
  }

  const metadata = {};
  if (Array.isArray(doc.inputs)) metadata.inputs = doc.inputs;
  if (typeof doc.defaultMode === 'string') metadata.defaultMode = doc.defaultMode;
  if (Array.isArray(doc.autoApprove)) metadata.autoApprove = doc.autoApprove;

  return { servers, metadata };
}

/**
 * Parse a JSON or YAML configuration document into normalised server entries.
 * @param {string} raw - Raw document contents.
 * @param {string} file - File path used for error reporting.
 * @returns {{ servers: Array<{ name: string, config: Record<string, unknown> }>, metadata: Record<string, unknown> }}
 */
export function parseDocument(raw, file) {
  let doc;
  const ext = path.extname(file).toLowerCase();

  try {
    if (ext === '.yaml' || ext === '.yml') {
      doc = YAML.parse(raw) ?? {};
    } else {
      doc = JSON.parse(raw);
    }
  } catch (error) {
    const type = ext === '.yaml' || ext === '.yml' ? 'YAML' : 'JSON';
    throw new LayerError({
      name: 'config',
      method: 'parseDocument',
      message: 'Failed to parse {format} configuration document "{file}": {reason}',
      vars: { format: type, file, reason: error instanceof Error ? error.message : 'unknown error' }
    });
  }

  return extractServers(doc ?? {}, file);
}

/**
 * Serialize server definitions into JSON or YAML while preserving metadata.
 * @param {string} file - Destination config file path.
 * @param {{ name: string, config: Record<string, unknown> } | null} entry - Server entry to upsert or null to overwrite with metadata.servers.
 * @param {{ servers?: Array<{ name: string, config: Record<string, unknown> }> } & Record<string, unknown>} [metadata] - Optional metadata to merge into the file.
 * @returns {Promise<void>}
 */
export async function writeDocument(file, entry, metadata = {}) {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });

  const ext = path.extname(file).toLowerCase();
  const isYaml = ext === '.yaml' || ext === '.yml';

  let doc;
  try {
    const raw = await fs.readFile(file, 'utf8');
    doc = isYaml ? YAML.parse(raw) : JSON.parse(raw);
  } catch {
    doc = {};
  }

  const body = doc && typeof doc === 'object' ? /** @type {Record<string, unknown>} */ (doc) : {};
  let key = 'mcpServers';
  if (body.mcpServers && typeof body.mcpServers === 'object') {
    key = 'mcpServers';
  } else if (body.servers && typeof body.servers === 'object') {
    key = 'servers';
  }

  if (!body[key] || typeof body[key] !== 'object') {
    body[key] = {};
  }

  const serversNode = /** @type {Record<string, unknown>} */ (body[key]);

  if (entry) {
    serversNode[entry.name] = entry.config;
  } else if (Array.isArray(metadata.servers)) {
    for (const name of Object.keys(serversNode)) {
      delete serversNode[name];
    }
    for (const item of metadata.servers) {
      serversNode[item.name] = item.config;
    }
  }

  if (metadata && typeof metadata === 'object') {
    for (const [metaKey, value] of Object.entries(metadata)) {
      if (metaKey === 'servers') continue;
      body[metaKey] = value;
    }
  }

  const output = isYaml
    ? YAML.stringify(body)
    : `${JSON.stringify(body, null, 2)}\n`;
  await fs.writeFile(file, output, 'utf8');
}
