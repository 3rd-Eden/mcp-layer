import { z } from 'zod';

/**
 * Register the booking tool that triggers elicitation workflows.
 * @param {import('@modelcontextprotocol/sdk/server/mcp.js').McpServer} server - MCP server to register the tool on.
 * @param {{ hasCapability: (capability: 'elicitation') => boolean }} capabilities - Capability checker for elicitation support.
 */
export function registerBooking(server, capabilities) {
  const inputSchema = {
    restaurant: z.string().min(1),
    date: z.string().min(1),
    guests: z.number().int().min(1).max(12)
  };

  /**
   * Demonstrate elicitation by asking for alternate booking dates.
   * @param {{ restaurant: string, date: string, guests: number }} args - Booking request inputs.
   * @returns {Promise<import('@modelcontextprotocol/sdk/types.js').CallToolResult>}
   */
  async function bookingTool(args) {
    const baseMessage = `No tables available at ${args.restaurant} on ${args.date}.`;
    if (!capabilities.hasCapability('elicitation')) {
      return {
        content: [
          {
            type: 'text',
            text: `${baseMessage} Client did not declare elicitation capability.`
          }
        ],
        structuredContent: {
          confirmed: false,
          alternateDate: null,
          message: `${baseMessage} Client lacks elicitation support.`
        }
      };
    }

    try {
      const result = await server.server.elicitInput({
        message: `${baseMessage} Provide an alternate date to continue.`,
        requestedSchema: {
          type: 'object',
          properties: {
            confirmAlternate: {
              type: 'boolean',
              title: 'Confirm alternate date',
              description: 'Confirm whether we should book an alternate date.'
            },
            alternateDate: {
              type: 'string',
              title: 'Preferred alternate date',
              description: 'ISO-8601 date string for the alternate booking.'
            }
          },
          required: ['confirmAlternate']
        }
      });

      const confirmed = result.action === 'accept' && Boolean(result.content?.confirmAlternate);
      const alternate = confirmed ? result.content?.alternateDate ?? args.date : null;
      const message = confirmed ? `Reservation confirmed for ${alternate ?? args.date}.` : `${baseMessage} Request declined.`;
      return {
        content: [
          {
            type: 'text',
            text: message
          }
        ],
        structuredContent: {
          confirmed,
          alternateDate: alternate,
          message
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [
          {
            type: 'text',
            text: message
          }
        ],
        structuredContent: {
          confirmed: false,
          alternateDate: null,
          message
        }
      };
    }
  }

  server.registerTool(
    'booking',
    {
      title: 'Booking',
      description: 'Trigger elicitation/create to confirm alternate dates.',
      inputSchema,
      outputSchema: {
        confirmed: z.boolean(),
        alternateDate: z.string().nullable(),
        message: z.string()
      }
    },
    bookingTool
  );
}
