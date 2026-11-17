/**
 * Complete the real local OAuth consent form and follow its loopback callback.
 * @param {URL} url SDK-generated authorization URL.
 * @returns {Promise<void>} Completed consent and callback request.
 */
export async function browser(url) {
  const page = await fetch(url);
  const html = await page.text();
  const form = new URLSearchParams();
  for (const input of html.matchAll(/<input\b[^>]*>/g)) {
    const name = input[0].match(/name="([^"]*)"/)?.[1];
    const value = input[0].match(/value="([^"]*)"/)?.[1] ?? '';
    if (name !== undefined) form.set(name, value.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  }
  form.set('decision', 'allow');
  const response = await fetch(new URL('/authorize', url), { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Local OAuth consent failed (${response.status}).`);
}
