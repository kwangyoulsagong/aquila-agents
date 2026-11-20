// Update check for macOS (T27): electron-updater against the GitHub releases in electron-builder.yml → publish.
// Builds are unsigned, and Squirrel.Mac refuses to install an unsigned update, so this only checks and notifies:
// clicking the notification opens the release page. Signed builds (T20) can turn on download + install here.
// Packaged app only; never in dev, smoke or capture.
import { Notification, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { Translate } from '../src/shared/i18n/dictionary';

const RELEASES = 'https://github.com/kwangyoulsagong/aquila-agents/releases';
const EVERY_MS = 6 * 60 * 60 * 1000;

/** Release page of a version (`v` tag, as electron-builder publishes it). */
export const releaseUrl = (version: string): string => `${RELEASES}/tag/v${version}`;

/** Starts checking (now, then every 6 h). `t` is read per notification so the language follows the setting. */
export function startUpdater(t: () => Translate): void {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.logger = null;
  const notified = new Set<string>();
  autoUpdater.on('update-available', (info: { version: string }) => {
    if (notified.has(info.version) || !Notification.isSupported()) return;
    notified.add(info.version);
    const tr = t();
    const n = new Notification({
      title: tr('update.title', { version: info.version }),
      body: tr('update.body'),
    });
    n.on('click', () => void shell.openExternal(releaseUrl(info.version)));
    n.show();
  });
  // Offline, no release yet, rate-limited: try again next time, quietly.
  autoUpdater.on('error', () => {});
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, EVERY_MS).unref();
}
