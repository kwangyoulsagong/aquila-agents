/**
 * Local dev-server addresses in terminal output (T33). Pure, with no Electron import: `runs.ts` (and through
 * `config.ts`, the history modules a worker thread loads, T70) use it without pulling in the preview views.
 */

// eslint-disable-next-line no-control-regex -- terminal escapes are control characters
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const LOCAL_URL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})(\/[^\s'"<>`)\]]*)?/g;

/** `0.0.0.0` / `127.0.0.1` / `[::1]` → localhost, trailing punctuation dropped, always a path. */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.replace(/[.,;:!?]+$/, ''));
  } catch {
    return raw;
  }
  if (['0.0.0.0', '127.0.0.1', '[::1]', '[::]'].includes(u.hostname)) u.hostname = 'localhost';
  return u.toString();
}

/**
 * A dev server announces itself at its root or a base path (`/`, `/app/`); deeper paths are request logs and API
 * calls (`GET http://localhost:8080/api/home/today`), not pages to preview.
 */
const isServerAddress = (url: string): boolean => {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length <= 1;
  } catch {
    return false;
  }
};

/** Local dev-server addresses in a piece of terminal output (colors stripped: Vite bolds the port). */
export function findDevUrls(text: string, ignorePorts: readonly number[] = []): string[] {
  const plain = text.replace(ANSI, '');
  const out: string[] = [];
  for (const m of plain.matchAll(LOCAL_URL)) {
    const port = Number(m[1]);
    if (port < 1 || port > 65535 || ignorePorts.includes(port)) continue;
    const u = normalizeUrl(m[0]);
    if (!isServerAddress(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}
