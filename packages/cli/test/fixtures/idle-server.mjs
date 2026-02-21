/**
 * No-op interval callback to keep the process alive.
 * @returns {void}
 */
function tick() {}

/**
 * Keep the test process running to simulate an unresponsive MCP server.
 * @returns {NodeJS.Timeout}
 */
function keepalive() {
  return setInterval(tick, 1000);
}

keepalive();
