import { attachPlatformatic, isPlatformaticInstance } from './platformatic.js';

/**
 * Determine whether a provider can handle the target instance.
 * @param {unknown} instance - Candidate instance to attach.
 * @returns {'platformatic' | null}
 */
export function matchProvider(instance) {
  if (isPlatformaticInstance(instance)) {
    return 'platformatic';
  }
  return null;
}

/**
 * Attach using a named provider.
 * @param {'platformatic'} provider - Provider identifier.
 * @param {unknown} instance - Provider-specific instance.
 * @param {string} name - Session name.
 * @param {{ info?: { name: string, version: string }, source?: string, path?: string }} opts - Attach options.
 * @returns {Promise<import('@mcp-layer/session').Session>}
 */
export async function attachWithProvider(provider, instance, name, opts) {
  if (provider === 'platformatic') {
    return attachPlatformatic(
      /** @type {import('fastify').FastifyInstance} */ (instance),
      name,
      opts
    );
  }
  throw new Error(`Unknown attach provider "${provider}".`);
}
