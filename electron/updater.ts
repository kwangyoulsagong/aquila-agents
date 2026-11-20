// Update check (T27, T20): electron-updater against the GitHub releases in electron-builder.yml → publish.
// - macOS: builds are unsigned and Squirrel.Mac refuses an unsigned update, so this only checks and notifies;
//   clicking the notification opens the release page.
// - Windows: the NSIS updater installs unsigned builds too (it checks the signature only when `publisherName` is set,
//   and always checks latest.yml's sha512), so it downloads in the background, installs on quit, and the
//   notification offers "restart now". The download carries no Mark-of-the-Web, so SmartScreen doesn't step in.
// Packaged app only; never in dev, smoke or capture.
import { Notification, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { Translate } from '../src/shared/i18n/dictionary';

const RELEASES = 'https://github.com/kwangyoulsagong/aquila-agents/releases';
const EVERY_MS = 6 * 60 * 60 * 1000;

/** Release page of a version (`v` tag, as electron-builder publishes it). */
export const releaseUrl = (version: string): string => `${RELEASES}/tag/v${version}`;

/** `install` where the updater can install our (unsigned) builds itself, else `notify` (open the release page). */
export const updateMode = (os: NodeJS.Platform): 'install' | 'notify' =>
  os === 'win32' ? 'install' : 'notify';

/** Starts checking (now, then every 6 h). `t` is read per notification so the language follows the setting. */
export function startUpdater(t: () => Translate): void {
  const install = updateMode(process.platform) === 'install';
  autoUpdater.autoDownload = install;
  autoUpdater.autoInstallOnAppQuit = install;
  autoUpdater.logger = null;
  const notified = new Set<string>();
  const notify = (key: string, title: string, body: string, onClick: () => void) => {
    if (notified.has(key) || !Notification.isSupported()) return;
    notified.add(key);
    const n = new Notification({ title, body });
    n.on('click', onClick);
    n.show();
  };
  if (install) {
    autoUpdater.on('update-downloaded', (info: { version: string }) => {
      const tr = t();
      notify(
        `ready:${info.version}`,
        tr('update.title', { version: info.version }),
        tr('update.ready'),
        () => {
          autoUpdater.quitAndInstall(true, true);
        },
      );
    });
  } else {
    autoUpdater.on('update-available', (info: { version: string }) => {
      const tr = t();
      notify(info.version, tr('update.title', { version: info.version }), tr('update.body'), () => {
        void shell.openExternal(releaseUrl(info.version));
      });
    });
  }
  // Offline, no release yet, rate-limited: try again next time, quietly.
  autoUpdater.on('error', () => {});
  const check = () => void autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, EVERY_MS).unref();
}
