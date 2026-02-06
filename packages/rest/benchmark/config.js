/**
 * Default benchmark configuration values.
 * @type {{ connections: number, duration: number, pipelining: number, sessions: number, timeout: number, host: string, port: number, tool: string, text: string, loud: boolean, target: string, method: string, mode: string, transport: string, payload: string, url: string, authMode: string, authScheme: string, authHeader: string, identities: number }}
 */
export const DEFAULTS = {
  connections: 100,
  duration: 10,
  pipelining: 1,
  sessions: 1,
  timeout: 10,
  host: '127.0.0.1',
  port: 0,
  tool: 'echo',
  text: 'hello',
  loud: false,
  target: '0',
  method: 'POST',
  mode: 'direct',
  transport: 'memory',
  payload: '',
  url: '',
  authMode: 'optional',
  authScheme: 'bearer',
  authHeader: 'authorization',
  identities: 1
};

/**
 * Parse a boolean-like value.
 * @param {string | undefined} value - Raw value from CLI args.
 * @returns {boolean | undefined}
 */
function bool(value) {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

/**
 * Parse a positive number.
 * @param {string} name - Option name.
 * @param {string | undefined} value - Raw value.
 * @returns {number}
 */
function num(name, value) {
  if (value === undefined) {
    throw new Error(`${name} requires a value.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

/**
 * Parse a port value (allows zero).
 * @param {string} value - Raw value.
 * @returns {number}
 */
function portnum(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('port must be zero or a positive number.');
  return parsed;
}

/**
 * Parse CLI arguments into an options object.
 * @param {string[]} args - CLI args.
 * @returns {Record<string, unknown>}
 */
export function parse(args) {
  const next = {};
  let idx = 0;

  while (idx < args.length) {
    const raw = args[idx];
    if (!raw || !raw.startsWith('--')) {
      idx += 1;
      continue;
    }

    const split = raw.slice(2).split('=');
    const key = split[0];
    const val = split.length > 1 ? split.slice(1).join('=') : undefined;

    if (key === 'connections') {
      next.connections = num('connections', val ?? args[idx + 1]);
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'duration') {
      next.duration = num('duration', val ?? args[idx + 1]);
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'pipelining') {
      next.pipelining = num('pipelining', val ?? args[idx + 1]);
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'sessions') {
      next.sessions = num('sessions', val ?? args[idx + 1]);
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'timeout') {
      next.timeout = num('timeout', val ?? args[idx + 1]);
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'port') {
      const raw = val ?? args[idx + 1];
      if (raw === undefined) throw new Error('port requires a value.');
      next.port = portnum(raw);
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'host') {
      next.host = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'tool') {
      next.tool = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'text') {
      next.text = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'target') {
      next.target = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'method') {
      next.method = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'mode') {
      next.mode = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'transport') {
      next.transport = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'payload') {
      next.payload = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'url') {
      next.url = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'auth-mode') {
      next.authMode = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'auth-scheme') {
      next.authScheme = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'auth-header') {
      next.authHeader = val ?? args[idx + 1];
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'identities') {
      next.identities = num('identities', val ?? args[idx + 1]);
      idx += val === undefined ? 2 : 1;
      continue;
    }

    if (key === 'loud') {
      const parsed = bool(val ?? args[idx + 1]);
      if (parsed !== undefined) {
        next.loud = parsed;
        idx += val === undefined ? 2 : 1;
        continue;
      }
      next.loud = true;
      idx += 1;
      continue;
    }

    if (key === 'no-loud') {
      next.loud = false;
      idx += 1;
      continue;
    }

    idx += 1;
  }

  return next;
}

/**
 * Merge defaults with overrides.
 * @param {typeof DEFAULTS} base - Base defaults.
 * @param {Record<string, unknown>} next - Overrides.
 * @returns {typeof DEFAULTS}
 */
function merge(base, next) {
  return {
    connections: typeof next.connections === 'number' ? next.connections : base.connections,
    duration: typeof next.duration === 'number' ? next.duration : base.duration,
    pipelining: typeof next.pipelining === 'number' ? next.pipelining : base.pipelining,
    sessions: typeof next.sessions === 'number' ? next.sessions : base.sessions,
    timeout: typeof next.timeout === 'number' ? next.timeout : base.timeout,
    host: typeof next.host === 'string' ? next.host : base.host,
    port: typeof next.port === 'number' ? next.port : base.port,
    tool: typeof next.tool === 'string' ? next.tool : base.tool,
    text: typeof next.text === 'string' ? next.text : base.text,
    loud: typeof next.loud === 'boolean' ? next.loud : base.loud,
    target: typeof next.target === 'string' ? next.target : base.target,
    method: typeof next.method === 'string' ? next.method : base.method,
    mode: typeof next.mode === 'string' ? next.mode : base.mode,
    transport: typeof next.transport === 'string' ? next.transport : base.transport,
    payload: typeof next.payload === 'string' ? next.payload : base.payload,
    url: typeof next.url === 'string' ? next.url : base.url,
    authMode: typeof next.authMode === 'string' ? next.authMode : base.authMode,
    authScheme: typeof next.authScheme === 'string' ? next.authScheme : base.authScheme,
    authHeader: typeof next.authHeader === 'string' ? next.authHeader : base.authHeader,
    identities: typeof next.identities === 'number' ? next.identities : base.identities
  };
}

/**
 * Validate finalized config.
 * @param {typeof DEFAULTS} cfg - Config to validate.
 * @returns {typeof DEFAULTS}
 */
function validate(cfg) {
  if (cfg.connections <= 0) throw new Error('connections must be a positive number.');
  if (cfg.duration <= 0) throw new Error('duration must be a positive number.');
  if (cfg.pipelining <= 0) throw new Error('pipelining must be a positive number.');
  if (cfg.sessions <= 0) throw new Error('sessions must be a positive number.');
  if (cfg.timeout <= 0) throw new Error('timeout must be a positive number.');
  if (cfg.port < 0) throw new Error('port must be zero or a positive number.');
  if (!cfg.host) throw new Error('host must be set.');
  if (!cfg.tool) throw new Error('tool must be set.');
  if (!cfg.method) throw new Error('method must be set.');
  if (!cfg.mode) throw new Error('mode must be set.');
  if (!cfg.transport) throw new Error('transport must be set.');
  if (cfg.payload) {
    try {
      JSON.parse(cfg.payload);
    } catch (error) {
      throw new Error('payload must be valid JSON.');
    }
  }
  if (!cfg.authMode) throw new Error('authMode must be set.');
  if (!cfg.authScheme) throw new Error('authScheme must be set.');
  if (!cfg.authHeader) throw new Error('authHeader must be set.');
  if (cfg.identities <= 0) throw new Error('identities must be a positive number.');
  return cfg;
}

/**
 * Load benchmark configuration.
 * @param {string[]} args - CLI args.
 * @returns {typeof DEFAULTS}
 */
export function load(args) {
  const base = { ...DEFAULTS };
  const next = parse(args);
  const cfg = merge(base, next);
  return validate(cfg);
}
