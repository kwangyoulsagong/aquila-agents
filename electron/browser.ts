// Open a page in a real browser (T51): Google Chrome when it's installed, else the system default.
import { execFile } from 'node:child_process';
import { shell } from 'electron';

const CHROME_BUNDLE = 'com.google.Chrome';

/** Only web pages leave the app this way. */
export const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url);

/**
 * `open -b com.google.Chrome <url>` on macOS (fails fast when Chrome isn't installed), then the default browser.
 * Elsewhere the default browser.
 */
export function openInBrowser(url: string): void {
  if (!isWebUrl(url)) return;
  if (process.platform !== 'darwin') {
    void shell.openExternal(url);
    return;
  }
  execFile('open', ['-b', CHROME_BUNDLE, url], (err) => {
    if (err) void shell.openExternal(url);
  });
}
