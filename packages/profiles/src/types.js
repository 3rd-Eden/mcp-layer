/** @typedef {'discovery' | 'registration' | 'authorization' | 'token' | 'refresh' | 'revocation' | 'mcp'} Phase */
/** @typedef {'downstream' | 'upstream'} Perspective */
/** @typedef {import('@modelcontextprotocol/sdk/types.js').Implementation} Implementation */
/** @typedef {Implementation & {platform?: string}} Identity */
/** @typedef {{source?: string, role?: 'client' | 'browser' | 'bridge' | 'server', issuer?: string}} Provenance */
/** @typedef {{phase: Phase, perspective: Perspective, headers?: HeadersInit, url?: string | URL, method?: string, message?: unknown, body?: unknown, status?: number, provenance?: Provenance}} Observation */
/** @typedef {{path: string, kind: 'credential' | 'session' | 'oauth' | 'identifier' | 'unclassified', scheme?: string, clientId?: string}} Redaction */
/** @typedef {{phase: Phase, perspective: Perspective, headers: Record<string, string>, url?: string, method?: string, message?: any, body?: any, status?: number, provenance?: Provenance, redactions: Redaction[]}} Evidence */
/** @typedef {{id?: string, client?: Identity, capturedAt?: string, allowHeaders?: string[]}} CaptureOptions */
/** @typedef {{schema: 1, id?: string, client?: Identity, capturedAt: string, allowHeaders: string[], observations: Evidence[]}} Capture */
/** @typedef {{observe: (observation: Observation) => Evidence, finish: () => Capture}} Recorder */
/** @typedef {{client_name?: string, software_id?: string, software_version?: string, client_uri?: string, logo_uri?: string, tos_uri?: string, policy_uri?: string, token_endpoint_auth_method?: string}} Metadata */
/** @typedef {{issuer: string, clientId: string, redirectUris?: string[], authMethod?: string}} Registration */
/** @typedef {{phases: Phase[], perspectives: Perspective[], identity: 'observed' | 'declared', observations: number}} Coverage */
/** @typedef {{schema: 1, id: string, client: Identity, capturedAt: string, evidence: Evidence[], coverage: Coverage, http: {headers: Record<string, string>, phases?: Partial<Record<Exclude<Phase, 'mcp'>, Record<string, string>>>, allowHeaders: string[]}, mcp: {clientInfo: Implementation, observed: {protocolVersions: string[], capabilities: object[]}}, oauth: {metadata: Metadata, clients: Registration[]}}} Profile */
/** @typedef {{id: string, signals: string[]}} Candidate */
/** @typedef {{status: 'matched' | 'ambiguous' | 'unknown', evidence: Evidence[], candidates: Candidate[]}} Match */
/** @typedef {{profiles?: Profile[]}} MatchOptions */
/** @typedef {'http' | 'mcp' | 'oauth'} Part */
/** @typedef {{parts?: Part[], phase?: Phase, headers?: HeadersInit, info?: Partial<Implementation> & {[key: string]: unknown}, fetch?: typeof globalThis.fetch, authProvider?: import('@modelcontextprotocol/sdk/client/auth.js').OAuthClientProvider, issuer?: string}} ApplyOptions */
/** @typedef {{headers: Headers, info: Implementation | undefined, fetch: typeof globalThis.fetch, authProvider: import('@modelcontextprotocol/sdk/client/auth.js').OAuthClientProvider | undefined}} Applied */

export {};
