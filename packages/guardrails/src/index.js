import { lookup } from 'node:dns/promises';
import net from 'node:net';
import { LayerError } from '@mcp-layer/error';

const PII_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PII_PHONE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const PII_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const PII_CARD = /\b(?:\d[ -]*?){13,16}\b/g;
const SECRET_PATTERNS = [
  /(api[_-]?key|token|password|secret)["\s:=]+[\w\-]{16,}/i,
  /bearer\s+[A-Za-z0-9\-._~+/]+=*/i,
  /sk-[A-Za-z0-9]{16,}/,
  /ghp_[A-Za-z0-9]{16,}/
];
const PROMPT_PATTERNS = [
  /ignore all (previous|prior) instructions/i,
  /reveal (the )?(system|hidden) prompt/i,
  /jailbreak/i,
  /bypass (safety|policy|guardrails)/i,
  /developer mode/i
];
const DEFAULT_LIMITS = {
  maxDepth: 12,
  maxStringLength: 8000,
  maxJsonBytes: 200000
};
const DEFAULT_DNS_TIMEOUT_MS = 2000;
const DEFAULT_DNS_CACHE_TTL_MS = 30000;
const DEFAULT_DNS_CACHE_MAX_ENTRIES = 256;

/**
 * Test whether a value is a plain object.
 * @param {unknown} value - Value to inspect.
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/**
 * Build a policy denial error.
 * @param {string} method - Source method name.
 * @param {string} message - Error message.
 * @param {string} code - Error code.
 * @param {Record<string, unknown>} [meta] - Extra metadata.
 * @returns {LayerError}
 */
function deny(method, message, code, meta = {}) {
  return new LayerError({
    name: 'guardrails',
    method,
    message,
    code,
    ...meta
  });
}

/**
 * Normalize wildcard rules into regular expressions.
 * @param {string[] | undefined} patterns - Rule patterns.
 * @returns {RegExp[]}
 */
function compile(patterns) {
  if (!Array.isArray(patterns)) return [];
  const list = [];

  for (const item of patterns) {
    if (typeof item !== 'string' || item.length === 0) continue;
    const escaped = item.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    list.push(new RegExp(`^${escaped}$`, 'i'));
  }

  return list;
}

/**
 * Check whether a value matches one of the compiled rules.
 * @param {string} value - Candidate value.
 * @param {RegExp[]} rules - Compiled regular expressions.
 * @returns {boolean}
 */
function matches(value, rules) {
  for (const rule of rules) {
    if (rule.test(value)) return true;
  }

  return false;
}

/**
 * Determine whether the current operation is a tool call.
 * @param {Record<string, unknown>} context - Operation context.
 * @returns {boolean}
 */
function isTool(context) {
  return context.method === 'tools/call';
}

/**
 * Determine whether the current operation is a prompt call.
 * @param {Record<string, unknown>} context - Operation context.
 * @returns {boolean}
 */
function isPrompt(context) {
  return context.method === 'prompts/get';
}

/**
 * Determine whether the current operation is a resource read.
 * @param {Record<string, unknown>} context - Operation context.
 * @returns {boolean}
 */
function isResource(context) {
  return context.method === 'resources/read';
}

/**
 * Recursively traverse JSON-like data.
 * @param {unknown} value - Value to traverse.
 * @param {(input: string) => string} transform - String transformer.
 * @returns {unknown}
 */
function walk(value, transform) {
  if (typeof value === 'string') return transform(value);
  if (Array.isArray(value)) return value.map(function mapItem(item) {
    return walk(item, transform);
  });

  if (isRecord(value)) {
    const next = {};

    for (const [key, item] of Object.entries(value)) {
      next[key] = walk(item, transform);
    }

    return next;
  }

  return value;
}

/**
 * Determine whether an IPv4/IPv6 string is private or local.
 * @param {string} address - IP address.
 * @returns {boolean}
 */
function isPrivate(address) {
  if (address === '127.0.0.1' || address === '::1') return true;
  if (address === '0.0.0.0' || address === '::') return true;
  if (address.startsWith('10.')) return true;
  if (address.startsWith('192.168.')) return true;
  if (address.startsWith('169.254.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(address)) return true;
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) return isPrivate(lower.slice(7));
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true;
  return false;
}

/**
 * Resolve DNS for an egress host with timeout enforcement.
 * @param {string} host - Hostname to resolve.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @returns {Promise<{ addresses: string[] }>}
 */
async function resolveHost(host, timeoutMs) {
  let timer;

  /**
   * Start a timeout promise that resolves to a sentinel object.
   * @returns {Promise<{ timedOut: true }>}
   */
  function timeoutTask() {
    return new Promise(function createTimeout(resolve) {
      /**
       * Resolve DNS timeout sentinel.
       * @returns {void}
       */
      function onTimeout() {
        resolve({ timedOut: true });
      }

      timer = setTimeout(onTimeout, timeoutMs);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
  }

  /**
   * Resolve DNS or return a wrapped error object.
   * @returns {Promise<{ addresses: string[] } | { error: unknown }>}
   */
  async function lookupTask() {
    try {
      const resolved = await lookup(host, { all: true, verbatim: true });
      return {
        addresses: resolved.map(function mapAddress(item) {
          return String(item.address);
        })
      };
    } catch (error) {
      return { error };
    }
  }

  const output = await Promise.race([lookupTask(), timeoutTask()]);

  if (timer) clearTimeout(timer);
  timer = undefined;

  if (output && typeof output === 'object' && 'timedOut' in output) {
    throw deny('egressPolicy', 'Egress host "{host}" resolution timed out.', 'EGRESS_POLICY_DENIED', {
      vars: { host }
    });
  }

  if (!output || typeof output !== 'object' || !('addresses' in output) || !Array.isArray(output.addresses) || output.addresses.length === 0) {
    throw deny('egressPolicy', 'Egress host "{host}" could not be resolved.', 'EGRESS_POLICY_DENIED', {
      vars: { host }
    });
  }

  return {
    addresses: output.addresses.map(function mapAddress(item) {
      return String(item);
    })
  };
}

/**
 * Extract string payloads from operation params.
 * @param {unknown} value - Input value.
 * @returns {string[]}
 */
function collectStrings(value) {
  const list = [];

  /**
   * Visit nested input values and collect strings.
   * @param {unknown} input - Candidate value.
   * @returns {void}
   */
  function visit(input) {
    if (typeof input === 'string') {
      list.push(input);
      return;
    }

    if (Array.isArray(input)) {
      for (const item of input) {
        visit(item);
      }
      return;
    }

    if (isRecord(input)) {
      for (const item of Object.values(input)) {
        visit(item);
      }
    }
  }

  visit(value);
  return list;
}

/**
 * Compute recursive object depth.
 * @param {unknown} value - Value to inspect.
 * @returns {number}
 */
function depth(value) {
  if (!isRecord(value) && !Array.isArray(value)) return 0;

  const list = Array.isArray(value) ? value : Object.values(value);
  let max = 0;

  for (const item of list) {
    const next = depth(item);
    if (next > max) max = next;
  }

  return max + 1;
}

/**
 * Create a tool deny-list guardrail.
 * @param {{ names?: string[] }} [options] - Guardrail options.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function denyTools(options = {}) {
  const rules = compile(options.names);

  /**
   * Validate tool execution against deny rules.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    if (!isTool(context)) return;
    const name = String(context.params?.name ?? '');
    if (!name || !matches(name, rules)) return;

    throw deny('denyTools', 'Tool "{tool}" is denied by policy.', 'GUARDRAIL_DENIED', {
      vars: { tool: name },
      tool: name
    });
  }

  return { name: 'deny-tools', before };
}

/**
 * Create a tool allow-list guardrail.
 * @param {{ names?: string[] }} [options] - Guardrail options.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function allowTools(options = {}) {
  const rules = compile(options.names);

  /**
   * Validate tool execution against allow rules.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    if (!isTool(context)) return;
    if (rules.length === 0) return;

    const name = String(context.params?.name ?? '');
    if (name && matches(name, rules)) return;

    throw deny('allowTools', 'Tool "{tool}" is not allowed by policy.', 'GUARDRAIL_DENIED', {
      vars: { tool: name || 'unknown' },
      tool: name || 'unknown'
    });
  }

  return { name: 'allow-tools', before };
}

/**
 * Create a prompt deny-list guardrail.
 * @param {{ names?: string[] }} [options] - Guardrail options.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function denyPrompts(options = {}) {
  const rules = compile(options.names);

  /**
   * Validate prompt execution against deny rules.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    if (!isPrompt(context)) return;

    const name = String(context.params?.name ?? '');
    if (!name || !matches(name, rules)) return;

    throw deny('denyPrompts', 'Prompt "{prompt}" is denied by policy.', 'GUARDRAIL_DENIED', {
      vars: { prompt: name },
      prompt: name
    });
  }

  return { name: 'deny-prompts', before };
}

/**
 * Create a prompt allow-list guardrail.
 * @param {{ names?: string[] }} [options] - Guardrail options.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function allowPrompts(options = {}) {
  const rules = compile(options.names);

  /**
   * Validate prompt execution against allow rules.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    if (!isPrompt(context)) return;
    if (rules.length === 0) return;

    const name = String(context.params?.name ?? '');
    if (name && matches(name, rules)) return;

    throw deny('allowPrompts', 'Prompt "{prompt}" is not allowed by policy.', 'GUARDRAIL_DENIED', {
      vars: { prompt: name || 'unknown' },
      prompt: name || 'unknown'
    });
  }

  return { name: 'allow-prompts', before };
}

/**
 * Create a resource deny-list guardrail.
 * @param {{ uris?: string[] }} [options] - Guardrail options.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function denyResources(options = {}) {
  const rules = compile(options.uris);

  /**
   * Validate resource execution against deny rules.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    if (!isResource(context)) return;
    const uri = String(context.params?.uri ?? '');
    if (!uri || !matches(uri, rules)) return;

    throw deny('denyResources', 'Resource "{uri}" is denied by policy.', 'GUARDRAIL_DENIED', {
      vars: { uri },
      uri
    });
  }

  return { name: 'deny-resources', before };
}

/**
 * Create a resource allow-list guardrail.
 * @param {{ uris?: string[] }} [options] - Guardrail options.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function allowResources(options = {}) {
  const rules = compile(options.uris);

  /**
   * Validate resource execution against allow rules.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    if (!isResource(context)) return;
    if (rules.length === 0) return;

    const uri = String(context.params?.uri ?? '');
    if (uri && matches(uri, rules)) return;

    throw deny('allowResources', 'Resource "{uri}" is not allowed by policy.', 'GUARDRAIL_DENIED', {
      vars: { uri: uri || 'unknown' },
      uri: uri || 'unknown'
    });
  }

  return { name: 'allow-resources', before };
}

/**
 * Create principal-aware allow/deny policy guardrail.
 * @param {{ field?: string, requirePrincipal?: boolean, principals?: Record<string, { allowTools?: string[], denyTools?: string[], allowPrompts?: string[], denyPrompts?: string[], allowResources?: string[], denyResources?: string[] }> }} [input] - Principal policy configuration.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function principalPolicy(input = {}) {
  const field = typeof input.field === 'string' && input.field.length > 0 ? input.field : 'principal';
  const requirePrincipal = input.requirePrincipal === undefined ? true : Boolean(input.requirePrincipal);
  const principals = new Map();

  if (isRecord(input.principals)) {
    for (const [principal, rules] of Object.entries(input.principals)) {
      if (!isRecord(rules)) continue;
      principals.set(String(principal), {
        allowTools: compile(Array.isArray(rules.allowTools) ? rules.allowTools : []),
        denyTools: compile(Array.isArray(rules.denyTools) ? rules.denyTools : []),
        allowPrompts: compile(Array.isArray(rules.allowPrompts) ? rules.allowPrompts : []),
        denyPrompts: compile(Array.isArray(rules.denyPrompts) ? rules.denyPrompts : []),
        allowResources: compile(Array.isArray(rules.allowResources) ? rules.allowResources : []),
        denyResources: compile(Array.isArray(rules.denyResources) ? rules.denyResources : [])
      });
    }
  }

  /**
   * Require principal metadata and enforce principal-specific method rules.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    if (principals.size === 0) return;

    const principal = typeof context.meta?.[field] === 'string' ? context.meta[field] : '';
    if (!principal) {
      if (!requirePrincipal) return;
      throw deny('principalPolicy', 'Principal metadata "{field}" is required by policy.', 'GUARDRAIL_DENIED', {
        vars: { field }
      });
    }

    const rules = principals.get(principal);
    if (!rules) {
      throw deny('principalPolicy', 'Principal "{principal}" is not recognized by policy.', 'GUARDRAIL_DENIED', {
        vars: { principal }
      });
    }

    if (isTool(context)) {
      const name = String(context.params?.name ?? '');
      if (name && matches(name, rules.denyTools)) {
        throw deny('principalPolicy', 'Tool "{tool}" is denied for principal "{principal}".', 'GUARDRAIL_DENIED', {
          vars: { tool: name, principal },
          tool: name,
          principal
        });
      }
      if (rules.allowTools.length > 0 && (!name || !matches(name, rules.allowTools))) {
        throw deny('principalPolicy', 'Tool "{tool}" is not allowed for principal "{principal}".', 'GUARDRAIL_DENIED', {
          vars: { tool: name || 'unknown', principal },
          tool: name || 'unknown',
          principal
        });
      }
      return;
    }

    if (isPrompt(context)) {
      const name = String(context.params?.name ?? '');
      if (name && matches(name, rules.denyPrompts)) {
        throw deny('principalPolicy', 'Prompt "{prompt}" is denied for principal "{principal}".', 'GUARDRAIL_DENIED', {
          vars: { prompt: name, principal },
          prompt: name,
          principal
        });
      }
      if (rules.allowPrompts.length > 0 && (!name || !matches(name, rules.allowPrompts))) {
        throw deny('principalPolicy', 'Prompt "{prompt}" is not allowed for principal "{principal}".', 'GUARDRAIL_DENIED', {
          vars: { prompt: name || 'unknown', principal },
          prompt: name || 'unknown',
          principal
        });
      }
      return;
    }

    if (!isResource(context)) return;
    const uri = String(context.params?.uri ?? '');
    if (uri && matches(uri, rules.denyResources)) {
      throw deny('principalPolicy', 'Resource "{uri}" is denied for principal "{principal}".', 'GUARDRAIL_DENIED', {
        vars: { uri, principal },
        uri,
        principal
      });
    }
    if (rules.allowResources.length > 0 && (!uri || !matches(uri, rules.allowResources))) {
      throw deny('principalPolicy', 'Resource "{uri}" is not allowed for principal "{principal}".', 'GUARDRAIL_DENIED', {
        vars: { uri: uri || 'unknown', principal },
        uri: uri || 'unknown',
        principal
      });
    }
  }

  return { name: 'principal-policy', before };
}

/**
 * Create a PII redaction guardrail.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void, after: (context: Record<string, unknown>) => void }}
 */
export function piiRedact() {
  /**
   * Redact PII-like patterns from text.
   * @param {string} text - Raw text.
   * @returns {string}
   */
  function redact(text) {
    let next = text;
    next = next.replace(PII_EMAIL, '[REDACTED_EMAIL]');
    next = next.replace(PII_PHONE, '[REDACTED_PHONE]');
    next = next.replace(PII_SSN, '[REDACTED_SSN]');
    next = next.replace(PII_CARD, '[REDACTED_CARD]');
    return next;
  }

  /**
   * Redact request payload.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    context.params = walk(context.params, redact);
  }

  /**
   * Redact response payload.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function after(context) {
    context.result = walk(context.result, redact);
  }

  return { name: 'pii-redact', before, after };
}

/**
 * Create a secret detection guardrail.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void, after: (context: Record<string, unknown>) => void }}
 */
export function secretDetect() {
  /**
   * Determine whether text includes secret-like data.
   * @param {string} text - Candidate string.
   * @returns {boolean}
   */
  function hasSecret(text) {
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.test(text)) return true;
    }

    return false;
  }

  /**
   * Validate a payload branch for secret material.
   * @param {unknown} value - Payload branch.
   * @param {'request' | 'response'} source - Source label.
   * @returns {void}
   */
  function scan(value, source) {
    const texts = collectStrings(value);

    for (const text of texts) {
      if (!hasSecret(text)) continue;

      throw deny('secretDetect', 'Potential secret detected in {source} payload.', 'GUARDRAIL_DENIED', {
        vars: { source }
      });
    }
  }

  /**
   * Validate request payload.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    scan(context.params, 'request');
  }

  /**
   * Validate response payload.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function after(context) {
    scan(context.result, 'response');
  }

  return { name: 'secret-detect', before, after };
}

/**
 * Create a prompt risk detector guardrail.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function promptRisk() {
  /**
   * Validate prompt-bearing payload strings.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    const texts = collectStrings(context.params);

    for (const text of texts) {
      for (const pattern of PROMPT_PATTERNS) {
        if (!pattern.test(text)) continue;

        throw deny('promptRisk', 'Prompt risk pattern detected in request.', 'GUARDRAIL_DENIED');
      }
    }
  }

  return { name: 'prompt-risk', before };
}

/**
 * Create payload shape and size limits guardrail.
 * @param {{ maxDepth?: number, maxStringLength?: number, maxJsonBytes?: number }} [input] - Limit overrides.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function payloadLimits(input = {}) {
  const cfg = {
    maxDepth: typeof input.maxDepth === 'number' && input.maxDepth > 0 ? input.maxDepth : DEFAULT_LIMITS.maxDepth,
    maxStringLength: typeof input.maxStringLength === 'number' && input.maxStringLength > 0 ? input.maxStringLength : DEFAULT_LIMITS.maxStringLength,
    maxJsonBytes: typeof input.maxJsonBytes === 'number' && input.maxJsonBytes > 0 ? input.maxJsonBytes : DEFAULT_LIMITS.maxJsonBytes
  };

  /**
   * Enforce payload limits.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    const payload = context.params ?? {};
    const json = JSON.stringify(payload);

    if (Buffer.byteLength(json, 'utf8') > cfg.maxJsonBytes) {
      throw deny('payloadLimits', 'Request payload exceeds maximum JSON size.', 'GUARDRAIL_DENIED');
    }

    if (depth(payload) > cfg.maxDepth) {
      throw deny('payloadLimits', 'Request payload exceeds maximum nesting depth.', 'GUARDRAIL_DENIED');
    }

    const texts = collectStrings(payload);
    for (const text of texts) {
      if (text.length <= cfg.maxStringLength) continue;
      throw deny('payloadLimits', 'Request payload contains an oversized string value.', 'GUARDRAIL_DENIED');
    }
  }

  return { name: 'payload-limits', before };
}

/**
 * Create egress policy validation for external scanner URLs.
 * @param {{ allowedHosts?: string[], allowedPorts?: number[], allowPrivateIps?: boolean, dnsTimeoutMs?: number, dnsCacheTtlMs?: number, resolve?: (host: string) => Promise<{ addresses: string[] }> }} [input] - Policy options.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => Promise<void> }}
 */
export function egressPolicy(input = {}) {
  const allowPrivateIps = Boolean(input.allowPrivateIps);
  const dnsTimeoutMs = typeof input.dnsTimeoutMs === 'number' && input.dnsTimeoutMs > 0
    ? input.dnsTimeoutMs
    : DEFAULT_DNS_TIMEOUT_MS;
  const dnsCacheTtlMs = typeof input.dnsCacheTtlMs === 'number' && input.dnsCacheTtlMs >= 0
    ? input.dnsCacheTtlMs
    : DEFAULT_DNS_CACHE_TTL_MS;
  const hosts = new Set(Array.isArray(input.allowedHosts) ? input.allowedHosts.map(function normalize(host) {
    return String(host).toLowerCase();
  }) : []);
  const ports = new Set(Array.isArray(input.allowedPorts) ? input.allowedPorts.map(function normalize(port) {
    return Number(port);
  }).filter(function valid(port) {
    return Number.isInteger(port) && port > 0 && port <= 65535;
  }) : []);
  const cache = new Map();
  const pending = new Map();
  const resolve = typeof input.resolve === 'function'
    ? input.resolve
    : function defaultResolve(host) {
      return resolveHost(host, dnsTimeoutMs);
    };

  /**
   * Persist a DNS resolution cache entry with bounded memory growth.
   * @param {string} host - Hostname cache key.
   * @param {string[]} addresses - Resolved IP addresses.
   * @returns {void}
   */
  function remember(host, addresses) {
    if (dnsCacheTtlMs <= 0) return;
    cache.set(host, { addresses, expiresAt: Date.now() + dnsCacheTtlMs });

    while (cache.size > DEFAULT_DNS_CACHE_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (typeof oldest !== 'string') break;
      cache.delete(oldest);
    }
  }

  /**
   * Resolve a hostname with in-flight deduplication and TTL caching.
   * @param {string} host - Hostname to resolve.
   * @returns {Promise<{ addresses: string[] }>}
   */
  async function resolveCached(host) {
    const now = Date.now();
    const saved = cache.get(host);

    if (saved && saved.expiresAt > now) {
      // Refresh insertion order on hit to keep active keys when trimming.
      cache.delete(host);
      cache.set(host, saved);
      return {
        addresses: saved.addresses.map(function mapAddress(item) {
          return String(item);
        })
      };
    }

    if (saved) cache.delete(host);

    const inflight = pending.get(host);
    if (inflight) return inflight;

    /**
     * Execute resolver and normalize output.
     * @returns {Promise<{ addresses: string[] }>}
     */
    async function task() {
      try {
        const output = await resolve(host);
        const addresses = Array.isArray(output?.addresses)
          ? output.addresses.map(function mapAddress(item) {
            return String(item);
          }).filter(function keep(item) {
            return item.length > 0;
          })
          : [];

        if (addresses.length === 0) {
          throw deny('egressPolicy', 'Egress host "{host}" could not be resolved.', 'EGRESS_POLICY_DENIED', {
            vars: { host }
          });
        }

        remember(host, addresses);
        return { addresses };
      } catch (error) {
        if (error instanceof LayerError) throw error;
        throw deny('egressPolicy', 'Egress host "{host}" could not be resolved.', 'EGRESS_POLICY_DENIED', {
          vars: { host },
          cause: error
        });
      } finally {
        pending.delete(host);
      }
    }

    const run = task();
    pending.set(host, run);
    return run;
  }

  /**
   * Validate egress URL metadata.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {Promise<void>}
   */
  async function before(context) {
    const target = typeof context.meta?.egressUrl === 'string' ? context.meta.egressUrl : '';
    if (!target) return;

    let parsed;

    try {
      parsed = new URL(target);
    } catch {
      throw deny('egressPolicy', 'Invalid egress URL.', 'EGRESS_POLICY_DENIED');
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw deny('egressPolicy', 'Egress URL must use HTTP or HTTPS.', 'EGRESS_POLICY_DENIED');
    }

    const port = parsed.port
      ? Number(parsed.port)
      : parsed.protocol === 'https:'
        ? 443
        : 80;

    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw deny('egressPolicy', 'Egress URL uses an invalid port.', 'EGRESS_POLICY_DENIED');
    }

    if (ports.size > 0 && !ports.has(port)) {
      throw deny('egressPolicy', 'Egress port "{port}" is not allow-listed.', 'EGRESS_POLICY_DENIED', {
        vars: { port: String(port) }
      });
    }

    if (parsed.username || parsed.password) {
      throw deny('egressPolicy', 'Egress URL must not include credentials.', 'EGRESS_POLICY_DENIED');
    }

    const host = parsed.hostname.toLowerCase();
    if (hosts.size > 0 && !hosts.has(host)) {
      throw deny('egressPolicy', 'Egress host "{host}" is not allow-listed.', 'EGRESS_POLICY_DENIED', {
        vars: { host }
      });
    }

    const directIp = net.isIP(host) ? host : null;
    if (directIp && isPrivate(directIp) && !allowPrivateIps) {
      throw deny('egressPolicy', 'Private IP targets are blocked by egress policy.', 'EGRESS_POLICY_DENIED');
    }

    if (!directIp) {
      const info = await resolveCached(host);
      for (const address of info.addresses) {
        if (!isPrivate(address) || allowPrivateIps) continue;
        throw deny('egressPolicy', 'Resolved egress target maps to a private IP.', 'EGRESS_POLICY_DENIED');
      }
    }

    if (context.meta && context.meta.followRedirects === true) {
      throw deny('egressPolicy', 'Redirect-following is blocked by egress policy.', 'EGRESS_POLICY_DENIED');
    }
  }

  return { name: 'egress-policy', before };
}

/**
 * Create an approval-gate guardrail for high-risk operations.
 * @param {{ tools?: string[] }} [input] - High-risk tool names.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function approvalGate(input = {}) {
  const tools = new Set(Array.isArray(input.tools) ? input.tools.map(String) : []);

  /**
   * Enforce explicit approval for risky tool calls.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    if (!isTool(context)) return;

    const name = String(context.params?.name ?? '');
    if (!tools.has(name)) return;
    if (context.meta?.approved === true) return;

    throw deny('approvalGate', 'Tool "{tool}" requires explicit approval.', 'APPROVAL_REQUIRED', {
      vars: { tool: name },
      tool: name
    });
  }

  return { name: 'approval-gate', before };
}

/**
 * Create a session binding guardrail.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function sessionBinding() {
  /**
   * Validate session ownership metadata.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    const owner = context.meta?.sessionOwner;
    const requestor = context.meta?.requestOwner;
    if (!owner || !requestor) return;
    if (owner === requestor) return;

    throw deny('sessionBinding', 'Session ownership mismatch for operation.', 'GUARDRAIL_DENIED');
  }

  return { name: 'session-binding', before };
}

/**
 * Create a rate limiting guardrail.
 * @param {{ limit?: number, intervalMs?: number }} [input] - Rate options.
 * @returns {{ name: string, before: (context: Record<string, unknown>) => void }}
 */
export function ratePolicy(input = {}) {
  const limit = typeof input.limit === 'number' && input.limit > 0 ? input.limit : 120;
  const intervalMs = typeof input.intervalMs === 'number' && input.intervalMs > 0 ? input.intervalMs : 60000;
  const counts = new Map();

  /**
   * Enforce rate limits per session.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function before(context) {
    const key = String(context.sessionId ?? 'shared');
    const now = Date.now();
    const current = counts.get(key) ?? { start: now, count: 0 };

    if (now - current.start >= intervalMs) {
      current.start = now;
      current.count = 0;
    }

    current.count += 1;
    counts.set(key, current);

    if (current.count <= limit) return;

    throw deny('ratePolicy', 'Rate limit exceeded for session "{session}".', 'RATE_LIMITED', {
      vars: { session: key },
      sessionId: key
    });
  }

  return { name: 'rate-policy', before };
}

/**
 * Create audit policy plugin.
 * @param {{ write?: (event: Record<string, unknown>) => void }} [input] - Audit options.
 * @returns {{ name: string, after: (context: Record<string, unknown>) => void, error: (context: Record<string, unknown>) => void }}
 */
export function auditPolicy(input = {}) {
  const sink = typeof input.write === 'function' ? input.write : function noop() {};

  /**
   * Emit a success event.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function after(context) {
    sink({
      type: 'success',
      at: new Date().toISOString(),
      operationId: context.operationId,
      method: context.method,
      sessionId: context.sessionId,
      serverName: context.serverName
    });
  }

  /**
   * Emit a failure event.
   * @param {Record<string, unknown>} context - Operation context.
   * @returns {void}
   */
  function error(context) {
    sink({
      type: 'error',
      at: new Date().toISOString(),
      operationId: context.operationId,
      method: context.method,
      sessionId: context.sessionId,
      serverName: context.serverName,
      message: context.error instanceof Error ? context.error.message : String(context.error)
    });
  }

  return { name: 'audit-policy', after, error };
}

/**
 * Build a guardrail profile plugin list.
 * @param {{ profile?: 'baseline' | 'strict', allowTools?: string[], denyTools?: string[], allowPrompts?: string[], denyPrompts?: string[], allowResources?: string[], denyResources?: string[], principal?: { field?: string, requirePrincipal?: boolean, principals?: Record<string, { allowTools?: string[], denyTools?: string[], allowPrompts?: string[], denyPrompts?: string[], allowResources?: string[], denyResources?: string[] }> }, payload?: { maxDepth?: number, maxStringLength?: number, maxJsonBytes?: number }, egress?: { allowedHosts?: string[], allowedPorts?: number[], allowPrivateIps?: boolean, dnsTimeoutMs?: number, dnsCacheTtlMs?: number, resolve?: (host: string) => Promise<{ addresses: string[] }> }, approval?: { tools?: string[] }, rate?: { limit?: number, intervalMs?: number }, audit?: { write?: (event: Record<string, unknown>) => void } }} [input] - Profile configuration.
 * @returns {Array<Record<string, unknown>>}
 */
export function createGuardrails(input = {}) {
  const profile = input.profile === 'strict' ? 'strict' : 'baseline';
  const plugins = [];

  plugins.push(payloadLimits(input.payload));
  plugins.push(piiRedact());
  plugins.push(secretDetect());
  plugins.push(promptRisk());
  plugins.push(allowTools({ names: input.allowTools }));
  plugins.push(denyTools({ names: input.denyTools }));
  plugins.push(allowPrompts({ names: input.allowPrompts }));
  plugins.push(denyPrompts({ names: input.denyPrompts }));
  plugins.push(allowResources({ uris: input.allowResources }));
  plugins.push(denyResources({ uris: input.denyResources }));
  if (isRecord(input.principal)) {
    plugins.push(principalPolicy(input.principal));
  }

  if (profile === 'strict') {
    plugins.push(egressPolicy(input.egress));
    plugins.push(approvalGate(input.approval));
    plugins.push(sessionBinding());
    plugins.push(ratePolicy(input.rate));
    plugins.push(auditPolicy(input.audit));
  }

  return plugins;
}
