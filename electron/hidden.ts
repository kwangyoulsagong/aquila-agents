// Hidden runs: `AQUILA_HIDDEN=1` with smoke / perf (`npm run smoke:hidden`, `perf:hidden`) or the guide capture
// (`npm run capture:hidden`, which runs inside the smoke harness too). The run happens with nothing on the screen —
// every window fully transparent and click-through, never focused (input goes to the page directly), no Dock icon.
// The page still paints (smoke.ts / capture.ts keep the renderer from backgrounding), so rendering, timing,
// screenshots and `capturePage` frames are as on screen. Imported for its side effects before app ready.
import { app, Notification, type BrowserWindow } from 'electron';

export const isHidden =
  process.env.AQUILA_HIDDEN === '1' && (process.env.AQUILA_SMOKE === '1' || !!process.env.AQUILA_CAPTURE);

if (isHidden) {
  // The app may never become the active one (an app started from a terminal activates itself at launch, and app code
  // focuses web contents: the preview, terminals). "prohibited" also hides the Dock icon; windows still draw.
  const prohibit = () => {
    if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
    app.dock?.hide();
  };
  app.on('will-finish-launching', prohibit);
  void app.whenReady().then(prohibit);
  app.on('browser-window-created', (_e, w) => hideWindow(w));
  // No banners either: the window is never focused, so every waiting / failed demo session would notify.
  Notification.isSupported = () => false;
  Notification.prototype.show = () => undefined;
  // Every web contents (window, preview, extensions, the capture's encoder): focus is emulated, never taken from the OS.
  app.on('web-contents-created', (_e, wc) => {
    wc.focus = () => emulateFocusOf(wc);
  });
}

/** Makes `w` invisible and keeps it from taking focus: `show` / `focus` only reach the page. */
function hideWindow(w: BrowserWindow): void {
  // 1 %, not 0: macOS stops drawing a fully transparent window (requestAnimationFrame stalls); 1 % reads as nothing.
  w.setOpacity(0.01);
  w.setIgnoreMouseEvents(true);
  w.show = () => w.showInactive();
  // Never `webContents.focus()`: on macOS it makes the window key and activates the app for a moment, and a key the
  // user typed in another app then lands here (a stray "ㅅ" in a saved note). The page is told it has focus instead
  // (DevTools focus emulation); input reaches it through sendInputEvent / insertText, which don't need OS focus.
  w.focus = () => {
    if (!w.isVisible()) w.showInactive();
    emulateFocusOf(w.webContents);
  };
  w.webContents.on('did-finish-load', () => emulateFocusOf(w.webContents));
}

/** `document.hasFocus()`, focus events and `:focus` behave as if the window were focused, with no OS focus. */
function emulateFocusOf(wc: Electron.WebContents): void {
  const d = wc.debugger;
  try {
    if (!d.isAttached()) d.attach('1.3');
    void d.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
  } catch {
    // another client holds the debugger: the page just reports no focus
  }
}
