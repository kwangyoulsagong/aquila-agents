// Links clicked in the app window (terminal URLs, OSC 8 links Claude prints, run logs): never a window of ours.
// An http(s) link opens in the default browser; anything else is dropped. A child window of the app would show a
// blank page and could inherit the app's preload (its `window.aquila` API), so none is ever created.
import { isWebUrl } from './graph/note-file';

/** What to do with a `window.open` / navigation target: open it in the browser, or drop it. */
export const externalTarget = (url: string): string | null => (isWebUrl(url) ? url : null);

/** The app page itself (a dev-server reload, the bundled index.html): navigation stays allowed. */
export function isAppPage(url: string, appUrl: string): boolean {
  try {
    const a = new URL(url);
    const b = new URL(appUrl);
    return a.protocol === b.protocol && a.host === b.host && a.pathname === b.pathname;
  } catch {
    return false;
  }
}
