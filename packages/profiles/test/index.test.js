import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { capture, derive, list, get, match, apply } from '../src/index.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/capture.json', import.meta.url), 'utf8'));
const documentation = await readFile(new URL('../README.md', import.meta.url), 'utf8');

/**
 * Record the synthetic fixture through the public capture API.
 * @returns {import('../src/index.js').Capture} Sanitized fixture capture.
 */
function recorded() {
  const recorder = capture(fixture.options);
  for (const observation of fixture.observations) recorder.observe(observation);
  return recorder.finish();
}

/**
 * Assert a documented public error without exposing the original input.
 * @param {string} code - Stable error code.
 * @returns {(error: Error) => boolean} Assertion predicate.
 */
function failure(code) {
  /**
   * Inspect the public package error identity.
   * @param {Error & {code?: string, package?: string, reference?: string, docs?: string}} error - Thrown error.
   * @returns {boolean} Whether the error matches the contract.
   */
  function inspect(error) {
    assert.equal(error.code, code);
    assert.equal(error.package, '@mcp-layer/profiles');
    assert.match(error.reference, /^#[A-F0-9]{6}$/);
    assert.match(error.docs, /packages\/profiles\/README.md#error-/);
    assert.ok(documentation.includes(`id="${new URL(error.docs).hash.slice(1)}"`));
    return true;
  }
  return inspect;
}

/** @returns {void} Register the public profiles contract tests. */
function suite() {
  /** @returns {void} Register capture sanitation scenarios. */
  function captures() {
    /** @returns {void} Verify redaction happens at observation time. */
    function redacts() {
      const recorder = capture(fixture.options);
      const observation = recorder.observe({
        phase: 'token', perspective: 'downstream', method: 'POST',
        url: 'https://user:fixture-secret-password@issuer.example/token?client_id=public-id&access_token=fixture-secret-query&code=fixture-secret-code',
        headers: {
          authorization: `Basic ${Buffer.from('public-basic:fixture-secret-basic').toString('base64')}`,
          cookie: 'session=fixture-secret-cookie', 'mcp-session-id': 'fixture-secret-session',
          'x-api-key': 'fixture-secret-key', 'x-unknown': 'fixture-secret-unknown',
          'user-agent': 'Fixture Desktop/2.3.4',
        },
        body: {
          client_id: 'public-id', client_secret: 'fixture-secret-body',
          access_token: 'fixture-secret-access', refresh_token: 'fixture-secret-refresh',
          id_token: 'fixture-secret-id', code: 'fixture-secret-code-body',
          code_verifier: 'fixture-secret-verifier', code_challenge: 'fixture-secret-challenge',
          state: 'fixture-secret-state', nested: { sessionId: 'fixture-secret-nested' },
        },
      });
      assert.doesNotMatch(JSON.stringify(observation), /fixture-secret-/);
      assert.doesNotMatch(JSON.stringify(recorder.finish()), /fixture-secret-/);
      assert.equal(observation.headers.authorization, '[redacted]');
      assert.ok(observation.redactions.some(
        /**
         * Find a classified public Basic client identifier.
         * @param {import('../src/index.js').Redaction} marker - Sanitized marker.
         * @returns {boolean} Whether Basic client identity was retained.
         */
        function basic(marker) { return marker.scheme === 'Basic' && marker.clientId === 'public-basic'; }));
      assert.equal(observation.body.client_id, 'public-id');
      assert.equal(observation.body.nested.sessionId, '[redacted]');
    }
    /** @returns {void} Verify forms, messages, and URLs are sanitized recursively. */
    function formats() {
      const recorder = capture();
      const form = recorder.observe({ phase: 'refresh', perspective: 'downstream', body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'fixture-secret-form', client_id: 'public' }) });
      const message = recorder.observe({ phase: 'mcp', perspective: 'downstream', message: { jsonrpc: '2.0', id: 'fixture-secret-request-id', method: 'tools/call', params: { name: 'test', arguments: { token: 'fixture-secret-tool' } }, result: { content: [{ text: 'fixture-secret-text' }] } } });
      const encoded = recorder.observe({ phase: 'token', perspective: 'downstream', body: 'client_id=public&code_verifier=fixture-secret-encoded' });
      const json = recorder.observe({ phase: 'token', perspective: 'downstream', body: '{"access_token":"fixture-secret-json"}' });
      assert.equal(form.body.refresh_token, '[redacted]');
      assert.equal(encoded.body.client_id, 'public');
      assert.doesNotMatch(JSON.stringify([form, message, encoded, json]), /fixture-secret-/);
    }
    /** @returns {void} Verify snapshots cannot mutate the recorder. */
    function snapshots() {
      const recorder = capture(fixture.options);
      const observation = recorder.observe(fixture.observations[0]);
      observation.headers['user-agent'] = 'changed';
      const result = recorder.finish();
      assert.equal(result.observations[0].headers['user-agent'], 'fixture-desktop/2.3.4');
      assert.deepEqual(recorder.finish(), result);
      assert.throws(
        /**
         * Attempt to extend a finished recorder.
         * @returns {void} Throws the documented finished-capture error.
         */
        function closed() { recorder.observe(fixture.observations[0]); }, failure('ERR_PROFILES_FINISHED'));
    }
    /** @returns {void} Verify credentials cannot be enabled with allowHeaders. */
    function protectedHeaders() {
      assert.throws(
        /**
         * Attempt to allowlist a credential header.
         * @returns {void} Throws the documented options error.
         */
        function forbidden() { capture({ allowHeaders: ['authorization'] }); }, failure('ERR_PROFILES_OPTIONS'));
      assert.throws(
        /**
         * Exercise rejection of unsupported public input.
         * @returns {void} Throws the documented validation error.
         */
        function invalid() { capture().observe({ phase: 'wrong', perspective: 'downstream' }); }, failure('ERR_PROFILES_OBSERVATION'));
    }
    /** @returns {void} Verify classifications survive imported sanitized evidence. */
    function basic() {
      const recorder = capture(fixture.options);
      recorder.observe({ phase: 'token', perspective: 'downstream', headers: { authorization: `Basic ${Buffer.from('public-basic:fixture-secret-basic').toString('base64')}` }, provenance: { issuer: 'https://issuer.example' } });
      const result = derive(recorder.finish());
      assert.deepEqual(result.oauth.clients, [{ issuer: 'https://issuer.example', clientId: 'public-basic' }]);
      assert.ok(result.evidence[0].redactions.some(
        /**
         * Find a Basic credential classification.
         * @param {import('../src/index.js').Redaction} marker - Sanitized marker.
         * @returns {boolean} Whether Basic scheme was retained.
         */
        function classified(marker) { return marker.scheme === 'Basic'; }));
      assert.doesNotMatch(JSON.stringify(result), /fixture-secret-/);
    }
    /** @returns {void} Verify URL-form client identifiers cannot hide credentials. */
    function identifiers() {
      const recorder = capture(fixture.options);
      const client = 'https://client.example/metadata?access_token=fixture-secret-client-id';
      recorder.observe({ phase: 'token', perspective: 'downstream', body: { client_id: client } });
      recorder.observe({ phase: 'authorization', perspective: 'downstream', url: `https://issuer.example/authorize?${new URLSearchParams({ client_id: client })}` });
      recorder.observe({ phase: 'token', perspective: 'downstream', headers: { authorization: `Basic ${Buffer.from(`${encodeURIComponent(client)}:fixture-secret-password`).toString('base64')}` } });
      assert.doesNotMatch(JSON.stringify(recorder.finish()), /fixture-secret-/);
    }
    it('redacts credentials before observe returns and retains classification', redacts);
    it('sanitizes forms, JSON strings, RPC payloads, and opaque IDs', formats);
    it('returns independent snapshots and closes recording on finish', snapshots);
    it('rejects secret header allowlists and invalid observations', protectedHeaders);
    it('preserves safe Basic client IDs and credential classification across imports', basic);
    it('redacts credentials embedded in URL-form public client identifiers', identifiers);
  }
  /** @returns {void} Register deterministic profile derivation scenarios. */
  function profiles() {
    /** @returns {void} Verify identity and public metadata selection. */
    function selects() {
      const result = derive(recorded());
      assert.deepEqual(result.client, fixture.options.client);
      assert.deepEqual(result.mcp.clientInfo, { name: 'fixture-desktop', version: '2.3.4' });
      assert.deepEqual(result.http.headers, { 'user-agent': 'fixture-desktop/2.3.4', 'x-public-flavor': 'desktop' });
      assert.equal(result.oauth.metadata.client_name, 'Fixture Desktop');
      assert.equal(result.oauth.metadata.software_id, 'fixture-desktop');
      assert.equal(result.oauth.metadata.redirect_uris, undefined);
      assert.deepEqual(result.oauth.clients, [{ issuer: 'https://issuer.example', clientId: 'public-registration' }]);
      assert.ok(result.coverage.phases.includes('registration'));
      assert.ok(result.evidence.some(
        /**
         * Find excluded upstream capture evidence.
         * @param {import('../src/index.js').Evidence} observation - Sanitized observation.
         * @returns {boolean} Whether perspective is upstream.
         */
        function upstream(observation) { return observation.perspective === 'upstream'; }));
      assert.doesNotMatch(JSON.stringify(result), /fixture-secret-|unclassified-value/);
      assert.deepEqual(derive(recorded()), result);
    }
    /** @returns {void} Verify only complete, unredacted DCR response metadata becomes a reusable constraint. */
    function registrations() {
      const recorder = capture(fixture.options);
      for (const observation of fixture.observations) recorder.observe(observation);
      recorder.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: 'callback-client', redirect_uris: ['https://client.example/callback?access_token=private'], token_endpoint_auth_method: 'none' }, provenance: { issuer: 'https://issuer.example' } });
      recorder.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: 'callback-client', redirect_uris: ['http://localhost:43121/callback'], token_endpoint_auth_method: 'none' }, provenance: { issuer: 'https://issuer.example' } });
      const profile = derive(recorder.finish());
      assert.deepEqual(profile.oauth.clients.find(
        /** @param {import('../src/index.js').Registration} value @returns {boolean} Whether this is the response-bound registration. */
        function callback(value) { return value.clientId === 'callback-client'; }), {
        issuer: 'https://issuer.example', clientId: 'callback-client', authMethod: 'none', redirectUris: ['http://localhost:43121/callback'],
      });
      const conflict = capture(fixture.options);
      for (const observation of fixture.observations) conflict.observe(observation);
      conflict.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: 'conflicting-client', redirect_uris: ['http://localhost:43121/callback'], token_endpoint_auth_method: 'none' }, provenance: { issuer: 'https://issuer.example' } });
      conflict.observe({ phase: 'registration', perspective: 'downstream', body: { client_id: 'conflicting-client', redirect_uris: ['http://localhost:43122/callback'], token_endpoint_auth_method: 'none' }, provenance: { issuer: 'https://issuer.example' } });
      assert.throws(
        /** @returns {void} Reject a registration with competing callback declarations. */
        function conflicting() { derive(conflict.finish()); }, failure('ERR_PROFILES_REGISTRATION'));
    }
    /** @returns {void} Verify OAuth identity is isolated by phase and contradictory same-phase data fails. */
    function phases() {
      const recorder = capture(fixture.options);
      recorder.observe(fixture.observations[0]);
      recorder.observe({ phase: 'discovery', perspective: 'downstream', headers: { 'user-agent': 'Bun/1.4.4' }, provenance: { role: 'client' } });
      recorder.observe({ phase: 'token', perspective: 'downstream', headers: { 'user-agent': 'Bun/1.4.4' }, provenance: { role: 'client' } });
      const profile = derive(recorder.finish());
      assert.equal(profile.http.headers['user-agent'], 'fixture-desktop/2.3.4');
      assert.deepEqual(profile.http.phases, { discovery: { 'user-agent': 'Bun/1.4.4' }, token: { 'user-agent': 'Bun/1.4.4' } });
      assert.equal(match({ phase: 'token', perspective: 'downstream', headers: { 'user-agent': 'Bun/1.4.4' } }, { profiles: [profile] }).status, 'matched');
      assert.equal(match({ phase: 'token', perspective: 'downstream', headers: { 'user-agent': 'fixture-desktop/2.3.4' } }, { profiles: [profile] }).status, 'unknown');
      const conflicting = capture(fixture.options);
      conflicting.observe(fixture.observations[0]);
      conflicting.observe({ phase: 'token', perspective: 'downstream', headers: { 'user-agent': 'Bun/1.4.4' }, provenance: { role: 'client' } });
      conflicting.observe({ phase: 'token', perspective: 'downstream', headers: { 'user-agent': 'Bun/1.5.0' }, provenance: { role: 'client' } });
      assert.throws(
        /**
         * Derive a profile with same-phase header disagreement.
         * @returns {void} Throws the documented conflict error.
         */
        function conflict() { derive(conflicting.finish()); }, failure('ERR_PROFILES_CONFLICT'));
    }
    /** @returns {void} Verify observed MCP identity is inferred without a label. */
    function infers() {
      const recorder = capture({ capturedAt: fixture.options.capturedAt });
      recorder.observe(fixture.observations[0]);
      const result = derive(recorder.finish());
      assert.equal(result.client.name, 'fixture-desktop');
      assert.match(result.id, /^fixture-desktop-2-3-4-/);
      assert.deepEqual(apply(result).info, result.mcp.clientInfo);
    }
    /** @returns {void} Verify browser and relay headers stay evidence only. */
    function limits() {
      const recorder = capture(fixture.options);
      recorder.observe(fixture.observations[3]);
      recorder.observe(fixture.observations[4]);
      const result = derive(recorder.finish());
      assert.deepEqual(result.http.headers, {});
      assert.deepEqual(result.mcp.observed, { protocolVersions: [], capabilities: [] });
      assert.equal(result.coverage.identity, 'declared');
    }
    /** @returns {void} Verify identity conflicts are surfaced instead of guessed. */
    function conflicts() {
      const recorder = capture(fixture.options);
      recorder.observe(fixture.observations[0]);
      recorder.observe({ ...fixture.observations[0], message: { method: 'initialize', params: { clientInfo: { name: 'another-client', version: '9' } } } });
      assert.throws(
        /**
         * Attempt to derive contradictory client identity.
         * @returns {void} Throws the documented conflict error.
         */
        function conflicting() { derive(recorder.finish()); }, failure('ERR_PROFILES_CONFLICT'));
      assert.throws(
        /**
         * Attempt to derive a capture without client identity.
         * @returns {void} Throws the documented missing-identity error.
         */
        function missing() { derive(capture().finish()); }, failure('ERR_PROFILES_IDENTITY'));
    }
    /** @returns {void} Verify imported captures cannot bypass sanitization. */
    function imports() {
      const imported = { schema: 1, ...fixture.options, observations: fixture.observations };
      const result = derive(imported);
      assert.doesNotMatch(JSON.stringify(result), /fixture-secret-|unclassified-value/);
      assert.throws(
        /**
         * Exercise rejection of unsupported public input.
         * @returns {void} Throws the documented validation error.
         */
        function invalid() { apply({ ...result, http: { headers: { authorization: 'Bearer fixture-secret-apply' }, allowHeaders: [] } }); }, failure('ERR_PROFILES_PROFILE'));
    }
    /** @returns {void} Verify imported captures are complete and deterministic. */
    function timestamps() {
      assert.throws(
        /**
         * Attempt to derive an incomplete imported capture.
         * @returns {void} Throws the documented capture-schema error.
         */
        function missingTimestamp() { derive({ schema: 1, client: fixture.options.client, allowHeaders: [], observations: [] }); }, failure('ERR_PROFILES_CAPTURE'));
      const recorder = capture(fixture.options);
      recorder.observe({ phase: 'mcp', perspective: 'downstream', message: { jsonrpc: '2.0', method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'fixture-desktop', version: '2.3.4' } } } } });
      assert.equal(derive(recorder.finish()).coverage.identity, 'observed');
    }
    it('derives only public client identity and issuer-bound IDs', selects);
    it('retains only unmodified DCR constraints and rejects conflicting registrations', registrations);
    it('keeps reusable HTTP identities phase-specific and rejects same-phase conflicts', phases);
    it('infers initialize identity and generates a deterministic ID', infers);
    it('excludes browser and bridge wire identity from replay', limits);
    it('rejects conflicting or absent client identity', conflicts);
    it('sanitizes imported captures and validates profiles before apply', imports);
    it('requires imported timestamps and observes request metadata identity', timestamps);
  }
  /** @returns {void} Register catalog and matching scenarios. */
  function catalog() {
    /** @returns {Promise<void>} Verify bundled entries rebuild from reviewed native captures. */
    async function verified() {
      const actual = JSON.parse(await readFile(new URL('./fixtures/claude-code.capture.json', import.meta.url), 'utf8'));
      const profile = derive(actual);
      const bundled = get('claude-code-2-1-325-7bd44ecf1368');
      assert.deepEqual(get('claude-code'), bundled);
      assert.deepEqual(profile, bundled);
      assert.deepEqual(list(), [bundled]);
      assert.deepEqual(bundled.client, {
        name: 'claude-code', version: '2.1.325', platform: 'darwin-arm64',
        title: 'Claude Code', description: "Anthropic's agentic coding tool", websiteUrl: 'https://claude.com/claude-code',
      });
      assert.deepEqual(bundled.coverage.phases, ['authorization', 'discovery', 'mcp', 'refresh', 'registration', 'revocation', 'token']);
      assert.equal(bundled.coverage.observations, 24);
      assert.deepEqual(bundled.http.headers, { 'user-agent': 'claude-code/2.1.325 (sdk-cli)' });
      assert.deepEqual(bundled.http.phases, {
        discovery: { 'user-agent': 'Bun/1.4.4' },
        refresh: { 'user-agent': 'Bun/1.4.4' },
        registration: { 'user-agent': 'Bun/1.4.4' },
        revocation: { 'user-agent': 'axios/1.15.2' },
        token: { 'user-agent': 'Bun/1.4.4' },
      });
      assert.deepEqual(bundled.oauth.metadata, { client_name: 'Claude Code (mcp-layer-capture)', token_endpoint_auth_method: 'none' });
      assert.equal(bundled.oauth.clients.length, 1);
      assert.match(bundled.oauth.clients[0].issuer, /^http:\/\/127\.0\.0\.1:\d+\/$/);
      assert.deepEqual(bundled.mcp.observed.protocolVersions, ['2025-11-25', '2026-07-28']);
      assert.equal(bundled.evidence.find(
        /**
         * Find the native MCP capability discovery request.
         * @param {import('../src/index.js').Evidence} evidence - Sanitized native observation.
         * @returns {boolean} Whether the evidence is the discover request.
         */
        function discover(evidence) { return evidence.phase === 'mcp' && evidence.message?.method === 'server/discover'; }).message.method, 'server/discover');
      assert.doesNotMatch(JSON.stringify(bundled), /Bearer [A-Za-z0-9._-]{12,}|fixture-secret-|"(?:access_token|refresh_token|code_verifier|code|state)":"(?!\[redacted\])/);
      assert.throws(
        /**
         * Attempt to load an unknown profile.
         * @returns {void} Throws the documented unknown-profile error.
         */
        function absent() { get('unverified-client'); }, failure('ERR_PROFILES_UNKNOWN'));
      const result = match(actual.observations[0]);
      assert.equal(result.status, 'matched');
      assert.equal(result.candidates[0].id, bundled.id);
    }
    /** @returns {void} Verify caller-owned catalogs produce evidence-backed candidates. */
    function candidates() {
      const profile = derive(recorded());
      const result = match(fixture.observations[0], { profiles: [profile] });
      assert.equal(result.status, 'matched');
      assert.equal(result.candidates[0].id, profile.id);
      assert.ok(result.evidence.length > 0);
      const ambiguous = match(fixture.observations[0], { profiles: [profile, { ...profile, id: 'another-capture' }] });
      assert.equal(ambiguous.status, 'ambiguous');
      assert.equal(match(fixture.observations[3], { profiles: [profile] }).status, 'unknown');
      assert.equal(match({ ...fixture.observations[0], message: undefined, headers: { 'user-agent': 'unrelated' } }, { profiles: [profile] }).status, 'unknown');
    }
    it('ships a real verified Claude Code capture and deterministic catalog profile', verified);
    it('returns matched, ambiguous, and unknown for caller-owned profiles', candidates);
  }
  /** @returns {void} Register runtime composition scenarios. */
  function composition() {
    /** @returns {void} Verify explicit options and part subsets. */
    function overrides() {
      const profile = derive(recorded());
      const result = apply(profile, { headers: { 'user-agent': 'runtime' }, info: { name: 'runtime-client' } });
      assert.equal(result.headers.get('user-agent'), 'runtime');
      assert.deepEqual(result.info, { name: 'runtime-client', version: '2.3.4' });
      assert.equal(result.authProvider, undefined);
      const subset = apply(profile, { parts: ['mcp'] });
      assert.equal(subset.headers.get('user-agent'), null);
      assert.deepEqual(subset.info, profile.mcp.clientInfo);
      assert.equal(apply(profile, { parts: [] }).info, undefined);
      const phaseCapture = capture(fixture.options);
      phaseCapture.observe(fixture.observations[0]);
      phaseCapture.observe({ phase: 'token', perspective: 'downstream', headers: { 'user-agent': 'Bun/1.4.4' } });
      const phaseProfile = derive(phaseCapture.finish());
      assert.equal(apply(phaseProfile, { phase: 'token' }).headers.get('user-agent'), 'Bun/1.4.4');
      assert.equal(apply(phaseProfile).headers.get('user-agent'), 'fixture-desktop/2.3.4');
      /** @returns {void} Reject partial runtime identity when no profile MCP identity is selected. */
      function incomplete() { apply(profile, { parts: [], info: { name: 'runtime' } }); }
      assert.throws(incomplete, failure('ERR_PROFILES_OPTIONS'));
      assert.throws(
        /**
         * Attempt to apply an unsupported profile part.
         * @returns {void} Throws the documented options error.
         */
        function unknown() { apply(profile, { parts: ['transport'] }); }, failure('ERR_PROFILES_OPTIONS'));
      assert.throws(
        /**
         * Attempt to apply a non-string MCP identity.
         * @returns {void} Throws the documented options error.
         */
        function invalidInfo() { apply(profile, { info: { name: 123 } }); }, failure('ERR_PROFILES_OPTIONS'));
      assert.throws(
        /**
         * Attempt to select an unsupported profile phase.
         * @returns {void} Throws the documented options error.
         */
        function invalidPhase() { apply(profile, { phase: 'unknown' }); }, failure('ERR_PROFILES_OPTIONS'));
      assert.throws(
        /**
         * Attempt to apply null runtime options.
         * @returns {void} Throws the documented options error.
         */
        function invalidOptions() { apply(profile, null); }, failure('ERR_PROFILES_OPTIONS'));
    }
    it('applies every identity part by default with explicit runtime overrides', overrides);
  }
  describe('capture', captures);
  describe('derive', profiles);
  describe('catalog and match', catalog);
  describe('apply', composition);
}

describe('@mcp-layer/profiles', suite);
