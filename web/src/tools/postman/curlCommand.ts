const CURL_RE = /^curl(?:\s|$)/i;
const URL_RE = /^(?:https?:\/\/|www\.)\S+/i;

export function normalizeCurlCommand(input: string): string {
  const s = String(input ?? '').trim();
  if (!s) return '';
  if (CURL_RE.test(s)) return s;
  return URL_RE.test(s) ? `curl ${s}` : s;
}
