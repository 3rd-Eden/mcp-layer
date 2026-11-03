import { attachFastify, isFastifyInstance } from './fastify.js';
import { LayerError } from '@mcp-layer/error';

/**
 * Determine whether a provider can handle the target instance.
 * @param {unknown} instance - Candidate instance to attach.
 * @returns {'fastify' | null} Fastify provider when `ready()` and `inject()` are available; otherwise `null`.
 */
export function matchProvider(instance) {
  if (isFastifyInstance(instance)) return 'fastify';
  return null;
}

/**
 * Attach using a named provider.
 * @param {'fastify'} provider - Provider identifier.
 * @param {unknown} instance - Provider-specific instance.
 * @param {string} name - Session name.
 * @param {{ info?: { name: string, version: string }, source?: string, path?: string, headers?: Record<string, string> }} opts - Optional client identity, source label, endpoint path, and static caller headers.
 * @returns {Promise<import('@mcp-layer/session').Session>} Connected session with client, transport, identity, and close lifecycle.
 */
export async function attachWithProvider(provider, instance, name, opts) {
  if (provider === 'fastify') {
    return attachFastify(
      /** @type {import('fastify').FastifyInstance} */ (instance),
      name,
      opts
    );
  }
  throw new LayerError({
    name: 'attach',
    method: 'attachWithProvider',
    message: 'Unknown attach provider "{provider}".',
    vars: { provider }
  });
}
