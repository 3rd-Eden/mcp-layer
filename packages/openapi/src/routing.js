import * as uriLib from 'uri-js';
import { LayerError } from '@mcp-layer/error';

/**
 * Test whether a value is a non-empty string.
 * @param {unknown} value - Value to test.
 * @returns {value is string}
 */
function isstring(value) {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Split a path into segments while preserving empty leading segment.
 * @param {string} path - Path to split.
 * @returns {string[]}
 */
function splitpath(path) {
  return path.split('/');
}

/**
 * Decode a path segment safely.
 * @param {string} value - Encoded segment.
 * @returns {string}
 */
function decodesegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    // Keep mapping stable for malformed inputs instead of throwing during
    // route generation.
    return value;
  }
}

/**
 * Encode path segments while preserving slashes.
 * @param {string} path - Path to encode.
 * @returns {string}
 */
function encodepath(path) {
  const parts = splitpath(path);
  const out = [];

  for (const part of parts) {
    if (part === '') {
      out.push('');
      continue;
    }
    out.push(encodeURIComponent(part));
  }

  return out.join('/');
}

/**
 * Encode a template path while preserving template expressions.
 * @param {string} path - Path containing template expressions.
 * @returns {string}
 */
function encodeTemplatePath(path) {
  const parts = splitpath(path);
  const out = [];

  for (const part of parts) {
    if (part === '') {
      out.push('');
      continue;
    }
    if (part.includes('{')) {
      out.push(part);
      continue;
    }
    out.push(encodeURIComponent(part));
  }

  return out.join('/');
}

/**
 * Strip query and fragment components from a template.
 * @param {string} value - Template string.
 * @returns {string}
 */
function stripTemplateSuffix(value) {
  const query = value.indexOf('?');
  const hash = value.indexOf('#');
  const cut = query === -1 ? hash : hash === -1 ? query : Math.min(query, hash);
  if (cut === -1) return value;
  return value.slice(0, cut);
}

/**
 * Attempt to parse a scheme URI using a standards-compliant parser.
 * @param {string} uri - Candidate URI.
 * @returns {{ scheme: string, host: string | null, path: string | null } | null}
 */
function parseuri(uri) {
  // Use a standards-compliant URI parser first, then apply deterministic MCP
  // mapping rules on top.
  const parsed = uriLib.parse(uri);
  if (!parsed || !parsed.scheme) return null;

  const scheme = parsed.scheme;
  const host = parsed.host ? parsed.host : null;
  const tail = parsed.path && parsed.path !== '/' ? parsed.path : null;
  return { scheme, host, path: tail };
}

/**
 * Detect whether a string looks like a scheme segment.
 * @param {string} value - Candidate scheme segment.
 * @returns {boolean}
 */
function isscheme(value) {
  return /^[a-z][a-z0-9+.-]*$/i.test(value);
}

/**
 * Normalize a mapped path into clean segments.
 * @param {string} path - HTTP route path.
 * @returns {string[]}
 */
function segment(path) {
  const trimmed = path.startsWith('/') ? path.slice(1) : path;
  if (trimmed.length === 0) return [];
  return trimmed.split('/').map(decodesegment);
}

/**
 * Build a mapped HTTP path from scheme data.
 * @param {string} scheme - URI scheme.
 * @param {string | null} host - Authority segment, if present.
 * @param {string | null} tail - Path segment, if present.
 * @returns {string}
 */
function buildpath(scheme, host, tail) {
  if (!host && !tail) {
    return `/${scheme}/_`;
  }

  if (host && !tail) {
    return `/${scheme}/${host}/_`;
  }

  if (!host && tail) {
    return `/${scheme}${tail}`;
  }

  return `/${scheme}/${host}${tail}`;
}

/**
 * Build a mapped HTTP path for a template URI.
 * @param {string} scheme - URI scheme.
 * @param {string | null} host - Authority segment, if present.
 * @param {string | null} tail - Path segment, if present.
 * @returns {string}
 */
function buildtemplatepath(scheme, host, tail) {
  if (!host && !tail) {
    return `/${scheme}/_`;
  }

  if (host && !tail) {
    if (host.includes('{')) {
      return `/${scheme}/${host}`;
    }
    return `/${scheme}/${host}/_`;
  }

  if (!host && tail) {
    return `/${scheme}${tail}`;
  }

  return `/${scheme}/${host}${tail}`;
}

/**
 * Map an MCP resource URI to an HTTP route path.
 * @param {string} uri - MCP resource URI.
 * @param {boolean} [encode=true] - Whether to percent-encode path segments.
 * @returns {string} HTTP route path (without version prefix).
 */
export function path(uri, encode = true) {
  if (!isstring(uri)) {
    throw new LayerError({
      name: 'openapi',
      method: 'path',
      message: 'Expected resource URI to be a non-empty string.',
    });
  }

  if (uri.startsWith('/')) {
    const path = encode ? encodepath(uri) : uri;
    return path;
  }

  const parsed = parseuri(uri);
  if (parsed) {
    const path = buildpath(parsed.scheme, parsed.host, parsed.path);
    return encode ? encodepath(path) : path;
  }

  const split = uri.indexOf('://');
  if (split !== -1) {
    const scheme = uri.slice(0, split);
    const rest = uri.slice(split + 3);

    if (!rest) {
      const path = buildpath(scheme, null, null);
      return encode ? encodepath(path) : path;
    }

    const slash = rest.indexOf('/');
    if (slash === -1) {
      const path = buildpath(scheme, rest, null);
      return encode ? encodepath(path) : path;
    }

    const host = rest.slice(0, slash);
    const tail = rest.slice(slash);
    const path = buildpath(scheme, host || null, tail || null);
    return encode ? encodepath(path) : path;
  }

  const path = `/${uri}`;
  return encode ? encodepath(path) : path;
}

/**
 * Map an MCP resource URI template to an HTTP route path.
 * @param {string} template - MCP resource URI template.
 * @param {boolean} [encode=true] - Whether to percent-encode static segments.
 * @returns {string} HTTP route path (without version prefix).
 */
export function tpath(template, encode = true) {
  if (!isstring(template)) {
    throw new LayerError({
      name: 'openapi',
      method: 'tpath',
      message: 'Expected resource URI template to be a non-empty string.',
    });
  }

  if (!template.includes('{')) return path(template, encode);

  const trimmed = stripTemplateSuffix(template);

  if (trimmed.startsWith('/')) return encode ? encodeTemplatePath(trimmed) : trimmed;

  const split = trimmed.indexOf('://');
  if (split !== -1) {
    const scheme = trimmed.slice(0, split);
    const rest = trimmed.slice(split + 3);

    if (!rest) {
      const out = buildtemplatepath(scheme, null, null);
      return encode ? encodeTemplatePath(out) : out;
    }

    const slash = rest.indexOf('/');
    if (slash === -1) {
      const out = buildtemplatepath(scheme, rest, null);
      return encode ? encodeTemplatePath(out) : out;
    }

    const host = rest.slice(0, slash);
    const tail = rest.slice(slash);
    const out = buildtemplatepath(scheme, host || null, tail || null);
    return encode ? encodeTemplatePath(out) : out;
  }

  const out = `/${trimmed}`;
  return encode ? encodeTemplatePath(out) : out;
}

/**
 * Reverse a mapped HTTP path back to its MCP resource URI.
 *
 * into MCP resource URIs for read requests.
 *
 * @param {string} path - HTTP route path.
 * @returns {string} Original MCP resource URI.
 */
export function uri(path) {
  if (!isstring(path)) {
    throw new LayerError({
      name: 'openapi',
      method: 'uri',
      message: 'Expected path to be a non-empty string.',
    });
  }

  const list = segment(path);

  if (list.length === 0) return '/';

  if (list.length === 2 && list[1] === '_') {
    return `${list[0]}://`;
  }

  if (list.length === 3 && list[2] === '_') {
    return `${list[0]}://${list[1]}`;
  }

  if (list.length >= 3 && isscheme(list[0]) && list[1]) {
    const rest = list.slice(2).join('/');
    return `${list[0]}://${list[1]}/${rest}`;
  }

  const last = list[list.length - 1] ?? '';
  // Heuristic: dotted filenames are more likely absolute paths than relative IDs.
  if (last.includes('.')) {
    return `/${list.join('/')}`;
  }

  return list.join('/');
}
