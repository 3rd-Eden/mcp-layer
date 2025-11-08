import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import { z } from 'zod';

const greeters = ['Ada', 'Casey', 'Echo', 'Mira'];
const tones = ['casual', 'formal', 'cheerful'];

/**
 * Register the welcome prompt with completable arguments.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server
 */
export function registerWelcomePrompt(server) {
  const argsSchema = {
    name: completable(z.string().min(1, 'Name is required'), function completeName(value) {
      const match = value.toLowerCase();
      return greeters.filter(function filterGreeters(entry) {
        return entry.toLowerCase().startsWith(match);
      });
    }),
    tone: completable(z.enum(tones).default('casual'), function completeTone(value, context) {
      const focus = context?.arguments?.name?.toLowerCase();
      const pool = focus === 'ada' ? ['formal', 'casual'] : tones;
      return pool.filter(function filterTone(entry) {
        return entry.startsWith(value);
      });
    })
  };

  /**
   * Produce a greeting message tailored to the provided tone.
   * @param {{ name: string, tone: 'casual' | 'formal' | 'cheerful' }} args
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').GetPromptResult>}
   */
  async function welcomePrompt(args) {
    const base =
      args.tone === 'formal'
        ? `Greetings ${args.name}, welcome to the MCP test server.`
        : args.tone === 'cheerful'
          ? `Hi ${args.name}! Enjoy the feature-complete MCP test server!`
          : `Hey ${args.name}! Enjoy exploring the test server.`;

    return {
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: base
          }
        }
      ]
    };
  }

  server.registerPrompt(
    'welcome',
    {
      title: 'Welcome Prompt',
      description: 'Generate a greeting message with customizable tone and completions.',
      argsSchema
    },
    welcomePrompt
  );
}
