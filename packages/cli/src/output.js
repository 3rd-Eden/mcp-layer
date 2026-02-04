import Table from 'cli-table3';

/**
 * Render a table to stdout.
 * @param {string[]} head - Table header labels.
 * @param {Array<string[]>} rows - Row data to render.
 * @returns {void}
 */
export function table(head, rows) {
  if (rows.length === 0) {
    process.stdout.write(`${head.join(' | ')}\n(no entries)\n`);
    return;
  }
  const t = new Table({ head });
  for (const row of rows) {
    t.push(row);
  }
  process.stdout.write(`${t.toString()}\n`);
}

/**
 * Render JSON output.
 * @param {unknown} data - Data to serialize as JSON.
 * @returns {void}
 */
export function jsonout(data) {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}
