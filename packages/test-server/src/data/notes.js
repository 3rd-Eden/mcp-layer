export const notes = new Map([
  [
    'echo',
    {
      summary: 'Echo repeats provided text and can force uppercase responses with the loud flag.',
      usage: 'Call echo with loud true to validate structured responses stay in sync with text output.'
    }
  ],
  [
    'add',
    {
      summary: 'Add combines two numbers and reports totals inside structuredContent for schema validation demos.',
      usage: 'Use add to confirm numeric handling prior to driving more complex tools.'
    }
  ],
  [
    'files',
    {
      summary: 'Files returns resource_link entries so clients can lazily fetch manual and note content.',
      usage: 'Provide a filter string to narrow which ResourceLinks appear in the response.'
    }
  ],
  [
    'summaries',
    {
      summary: 'Summaries requests sampling/createMessage and relays the returned completion back to the caller.',
      usage: 'Declare sampling capability before connecting so the server can proxy summarization requests.'
    }
  ],
  [
    'booking',
    {
      summary: 'Booking elicits alternate dates when the requested reservation is full.',
      usage: 'Clients respond to elicitation/create by echoing confirmAlternate and alternateDate fields.'
    }
  ],
  [
    'roots',
    {
      summary: 'Roots fetches file:// locations from the client by issuing roots/list.',
      usage: 'Declare roots capability and provide a handler that returns accessible filesystem URIs.'
    }
  ],
  [
    'logs',
    {
      summary: 'Logs forwards structured payloads via notifications/message respecting client log levels.',
      usage: 'Set logging/setLevel before invoking logs to ensure notifications arrive.'
    }
  ],
  [
    'progress',
    {
      summary: 'Progress sends notifications/progress tied to supplied request tokens during long tasks.',
      usage: 'Call the progress tool with a _meta.progressToken to observe incremental updates.'
    }
  ],
  [
    'note-update',
    {
      summary: 'Note-update mutates note resources and triggers notifications/resources/updated.',
      usage: 'Subscribe to note:// URIs before calling this tool to receive updates.'
    }
  ],
  [
    'rebalance',
    {
      summary: 'Rebalance flips tool registrations repeatedly to prove notification debouncing works.',
      usage: 'Expect only one notifications/tools/list_changed message even if multiple toggles run.'
    }
  ]
]);
