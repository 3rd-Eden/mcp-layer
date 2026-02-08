/**
 * @typedef {{ closers: Array<() => Promise<void>> }} Scope
 */

/** @type {Scope} */
let state = { closers: [] };

/**
 * Create test scope storage before each test.
 * @returns {void}
 */
export function setup() {
  state = { closers: [] };
}

/**
 * Register async cleanup callback for the active test scope.
 * @param {() => Promise<void>} close - Cleanup callback.
 * @returns {void}
 */
export function track(close) {
  state.closers.push(close);
}

/**
 * Close scoped resources after each test in reverse-creation order.
 * @returns {Promise<void>}
 */
export async function teardown() {
  for (let index = state.closers.length - 1; index >= 0; index -= 1) {
    const close = state.closers[index];
    await close();
  }
}
