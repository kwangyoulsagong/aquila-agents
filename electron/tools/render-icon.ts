// Renders build/icon.svg to build/icon.png (1024×1024, transparent) with Electron, so no image tools are needed.
// Run: npm run icon (compiles to dist-electron/electron/tools/render-icon.js and runs it with Electron).
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow } from 'electron';

const BUILD_DIR = path.join(__dirname, '..', '..', '..', 'build');

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(BUILD_DIR, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  const out = path.join(BUILD_DIR, 'icon.png');
  fs.writeFileSync(out, image.resize({ width: 1024, height: 1024 }).toPNG());
  console.log(`[icon] wrote ${out}`);
  app.quit();
});
