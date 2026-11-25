// `npm run smoke`: launch the built app, open a shell session, check the pty round-trips,
// check OSC 7501 (main answers the query; a report becomes the session status), check Ctrl+C stops a `yes` flood fast, open shells from the UI and check terminals on screen render with WebGL, save a screenshot to dist/smoke.png,
// open the first-run checklist from ⌘K (dist/smoke-first-run.png), project settings from ⌘K (dist/smoke-settings.png, Figma on: dist/smoke-settings-figma.png), the global shortcut dialog from ⌘K (dist/smoke-global-shortcut.png), open the guide with ⌘/ (dist/smoke-guide.png,
// dist/smoke-guide-shortcuts.png; every feature must show captured media), ⌘K → What's new (dist/smoke-whats-new.png;
// headlines with media, "How to use" opens the guide at that item), run the Korean IME scenarios (real composition
// events through Chromium's IME path via CDP; checks the exact bytes the terminal sends), then quit with exit code 0 (ok) or 1 (fail).
// Agents use this to verify their change actually runs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, clipboard, ClipboardItem, ipcMain } from 'electron';
import { showContextMenu } from './menu';
import { runCapture, withViews } from './capture';
import type { ExtensionHost } from './extensions';
import type { PreviewViews } from './preview';
import { runId, type RunManager } from './runs';
import { runPerf } from './perf';
import type { SessionManager } from './sessions';
import { checkRemoteSession } from './remote/smoke';
import { checkRealHost } from './remote/realHostSmoke';
import { readHookBody } from './hooks';
import { applyAction, isoDate } from './graph/vault';
import { IPC, type Config, type ConnectionUpdate, type ContextMenuItem } from '../src/shared/api/types';
import { translator } from '../src/shared/i18n/dictionary';

const MARKER = 'AQUILA_SMOKE_OK';
/** Printed by the shell only when it read our 7501 reply; computed so the echoed command never matches. */
const OSC_MARKER = 'AQUILA_7501_42';
const OSC_CHECK =
  "printf '\\033]7501;?\\007'; IFS= read -rs -t 3 -d '\\' r; " +
  'case "$r" in *states=*) echo AQUILA_7501_$((40+2));; esac; ' +
  "printf '\\033]7501;state=working:app=smoke\\007'\r";
/** `yes` floods the pty; after Ctrl+C the shell must answer within YES_BUDGET_MS (flow control keeps it responsive). */
/** T41: query 7501, then report "waiting" (a question), from a plain shell. */
const SUMMON_WAITING =
  "printf '\\033]7501;?\\007'; IFS= read -rs -t 2 -d '\\' r; printf '\\033]7501;state=blocked:app=smoke:kind=question\\007'\r";
/** T52: report "waiting" on a permission whose summary (base64 `msg`) is a destructive command. */
const RISKY_WAITING =
  "printf '\\033]7501;?\\007'; IFS= read -rs -t 2 -d '\\' r; printf '\\033]7501;state=blocked:app=smoke:kind=permission:msg=QmFzaDogcm0gLXJmIGRpc3Q=\\007'\r";
const RISKY_DONE = "printf '\\033]7501;state=idle:app=smoke\\007'\r";
/** T58: a turn that runs, then finishes. */
const TURN_DONE =
  "printf '\\033]7501;?\\007'; IFS= read -rs -t 2 -d '\\' r; printf '\\033]7501;state=working:app=smoke\\007'; sleep 0.3; printf '\\033]7501;state=done:app=smoke\\007'\r";
const YES_MARKER = 'AQUILA_YES_2';
const YES_FLOOD_MS = 1000;
const YES_BUDGET_MS = 3000;
/** Smoke keeps only the tail of the output (the `yes` flood would grow it without bound). */
export const SMOKE_BUFFER_BYTES = 256 * 1024;
const TIMEOUT_MS = 40000;
/** = MAX_GPU in src/entities/session/lib/gpuPool.ts (main only compiles shared/ from the renderer). */
const MAX_GPU = 12;

export const isSmoke = process.env.AQUILA_SMOKE === '1';
/** Links the app window sent to the browser during smoke (recorded instead of opening a browser). */
export const smokeLinks: string[] = [];

// Chromium's own data (localStorage, extension partitions, caches) in a temp folder: smoke / perf / capture never
// share the installed app's. Sharing it also made a running Aquila hold the storage lock, so the first localStorage
// read here waited ~3.9 s for it. Set at import, before app ready.
if (isSmoke) {
  // Chromium writes a few files at shutdown, after any exit handler: earlier runs' folders go here (not one that may
  // still be running alongside).
  for (const name of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('aquila-smoke-chromium-'))) {
    const dir = path.join(os.tmpdir(), name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > 10 * 60_000) fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* gone */
    }
  }
  const chromiumDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-smoke-chromium-'));
  app.setPath('userData', chromiumDir);
  // On process exit: perf ends with app.exit(), which skips the app's quit events.
  process.on('exit', () => fs.rmSync(chromiumDir, { recursive: true, force: true }));
}

/** Wrap the session `send` so smoke can watch pty output and status. */
export function watchOutput(
  send: (ch: string, p: unknown) => void,
  onData: (data: string) => void,
  onStatus: (status: string) => void = () => {},
  onConnection: (update: ConnectionUpdate) => void = () => {},
) {
  return (channel: string, payload: unknown) => {
    if (channel === 'session:data') onData((payload as { data: string }).data);
    if (channel === 'session:status') onStatus((payload as { status: string }).status);
    if (channel === IPC.sessionConnection) onConnection(payload as ConnectionUpdate);
    send(channel, payload);
  };
}

export async function runSmoke(
  win: BrowserWindow,
  sessions: SessionManager,
  config: Config,
  output: { buffer: string; statuses: string[]; connections: ConnectionUpdate[] },
  previews?: PreviewViews | null,
  runs?: RunManager | null,
  extensions?: ExtensionHost | null,
) {
  if (process.env.AQUILA_PERF === '1') return runPerf(win, sessions);
  if (process.env.AQUILA_CAPTURE) return runCapture(win, sessions, config, previews);
  let failed = false;
  const fail = (why: string) => {
    if (failed) return;
    failed = true;
    console.error(`[smoke] FAIL: ${why}`);
    void sessions.killAll().finally(() => app.exit(1));
  };
  const timer = setTimeout(() => fail('timeout'), TIMEOUT_MS);

  const project = config.projects[0];
  if (!project) return fail('no project in config');

  await new Promise((r) => setTimeout(r, 1500)); // let the renderer paint
  const { id } = sessions.create(config, project.id, 'shell');
  setTimeout(() => sessions.write(id, `echo ${MARKER}\r`), 1500);

  let step: 'echo' | 'osc' | 'yes' | 'interrupted' = 'echo';
  let interruptedAt = 0;
  const poll = setInterval(async () => {
    if (failed) return clearInterval(poll);
    if (step === 'echo') {
      if (!output.buffer.includes(MARKER)) return;
      step = 'osc';
      sessions.write(id, OSC_CHECK);
    }
    if (step === 'osc') {
      if (!output.buffer.includes(OSC_MARKER) || !output.statuses.includes('working')) return;
      step = 'yes';
      sessions.write(id, 'yes\r');
      setTimeout(() => {
        interruptedAt = Date.now();
        sessions.write(id, '\x03');
        // Computed so the echoed command line never matches.
        sessions.write(id, 'echo AQUILA_YES_$((1+1))\r');
        step = 'interrupted';
      }, YES_FLOOD_MS);
    }
    if (step !== 'interrupted') return;
    const waited = Date.now() - interruptedAt;
    if (!output.buffer.includes(YES_MARKER)) {
      if (waited > YES_BUDGET_MS) fail(`shell did not answer ${YES_BUDGET_MS} ms after Ctrl+C on \`yes\``);
      return;
    }
    console.log(`[smoke] Ctrl+C on \`yes\` answered in ~${waited} ms`);
    clearInterval(poll);
    clearTimeout(timer);
    // A packaged app can't write into its asar: put the screenshot in the temp dir instead.
    const outDir = app.isPackaged ? app.getPath('temp') : path.join(__dirname, '..', '..', 'dist');
    const out = path.join(outDir, 'smoke.png');
    // Open shells from the UI so the screenshot shows real xterms, and check WebGL follows what's on screen.
    const gpuError = await checkGpuFollowsScreen(win);
    if (gpuError) return fail(gpuError);
    fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
    const panesError = await checkPaneResizeAndZoom(win, outDir);
    if (panesError) return fail(panesError);
    const fullscreenError = await checkFullscreen(win, outDir);
    if (fullscreenError) return fail(fullscreenError);
    const findError = await checkPasteAndFind(win, outDir);
    if (findError) return fail(findError);
    const quickError = await checkQuickSelectFollows(win);
    if (quickError) return fail(quickError);
    const menuPasteError = await checkMenuPaste(win);
    if (menuPasteError) return fail(menuPasteError);
    const renameError = await checkRename(win, sessions, outDir);
    if (renameError) return fail(renameError);
    const promptError = await checkPromptTitle(win, sessions);
    if (promptError) return fail(promptError);
    const reasonError = await checkWaitingReason(win, sessions, outDir);
    if (reasonError) return fail(reasonError);
    const layoutError = await checkPanelLayout(win, outDir);
    if (layoutError) return fail(layoutError);
    const onPath = (bin: string) =>
      (process.env.PATH ?? '').split(':').some((dir) => dir && fs.existsSync(path.join(dir, bin)));
    console.log(`[smoke] PATH has claude: ${onPath('claude')}, codex: ${onPath('codex')}`);
    const firstRunError = await checkFirstRun(win, config, path.join(outDir, 'smoke-first-run.png'));
    if (firstRunError) return fail(firstRunError);
    const settingsError = await checkProjectSettings(win, config, path.join(outDir, 'smoke-settings.png'));
    if (settingsError) return fail(settingsError);
    const shortcutError = await checkGlobalShortcut(
      win,
      config,
      path.join(outDir, 'smoke-global-shortcut.png'),
    );
    if (shortcutError) return fail(shortcutError);
    const summonError = await checkSummonFromOtherApp(win, sessions);
    if (summonError) return fail(summonError);
    const guideError = await checkGuide(win, outDir);
    if (guideError) return fail(guideError);
    const linkOpenError = await checkLinks(win);
    if (linkOpenError) return fail(linkOpenError);
    const notesError = await checkWhatsNew(win, config, path.join(outDir, 'smoke-whats-new.png'));
    if (notesError) return fail(notesError);
    const trendsError = await checkTrends(win, outDir);
    if (trendsError) return fail(trendsError);
    const applyError = await checkApplyTrend(win, outDir);
    if (applyError) return fail(applyError);
    const sourcesError = await checkGraphSources(win, config, path.join(outDir, 'smoke-sources.png'));
    if (sourcesError) return fail(sourcesError);
    const graphError = await checkGraphView(win, config, outDir);
    if (graphError) return fail(graphError);
    const noteError = await checkNoteEditor(win, config, outDir);
    if (noteError) return fail(noteError);
    const linksError = await checkLinkSuggestions(win, config, outDir);
    if (linksError) return fail(linksError);
    const vaultError = await checkVault(win, config, outDir);
    if (vaultError) return fail(vaultError);
    const appGraphError = await checkAppGraph(win, config, outDir);
    if (appGraphError) return fail(appGraphError);
    const imeError = await checkIme(win);
    if (imeError) return fail(imeError);
    const reviewError = await checkReviewQueue(win, sessions, outDir);
    if (reviewError) return fail(reviewError);
    const runError = runs ? await checkRunSlot(win, runs, config, outDir) : 'no run manager';
    if (runError) return fail(runError);
    const previewError = previews ? await checkPreviewPick(previews) : 'no preview views';
    if (previewError) return fail(previewError);
    const extError = extensions
      ? await checkExtensions(win, extensions, sessions, config, outDir)
      : 'no extension host';
    if (extError) return fail(extError);
    const remoteError = await checkRemoteSession(sessions, config, output);
    if (remoteError) return fail(remoteError);
    const realHostError = await checkRealHost(sessions, config, output);
    if (realHostError) return fail(realHostError);
    console.log(
      `[smoke] OK — pty round-trip, OSC 7501, Ctrl+C under load, Korean IME, preview pick and remote reconnect work, screenshot: ${out}`,
    );
    void sessions.killAll().finally(() => app.exit(0));
  }, 200);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The page of the smoke extension: records what the API gives it and what was refused. */
const SMOKE_EXT_PAGE = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root { color-scheme: light dark; font: 13px/1.5 -apple-system, system-ui, sans-serif; }
      body { margin: 0; padding: 16px; }
      h1 { font-size: 15px; margin: 0 0 8px; }
      p { margin: 0 0 4px; }
    </style>
    <script src="aquila.js"></script>
  </head>
  <body>
    <h1>System meter</h1>
    <p id="cpu">…</p>
    <p id="mem">…</p>
    <p id="state">Running</p>
    <script>
      const r = (window.__smoke = { system: null, events: 0, fetch: 'pending', refused: 'pending', popup: null, paused: false });
      const show = (s) => {
        document.getElementById('cpu').textContent = 'CPU ' + s.cpu + '% · ' + s.cores + ' cores';
        document.getElementById('mem').textContent = 'Memory ' + (s.memory.used / 2 ** 30).toFixed(1) + ' / ' + (s.memory.total / 2 ** 30).toFixed(1) + ' GB';
        aquila.chip(Math.round(s.cpu) + '%');
      };
      aquila.system().then((s) => { r.system = s; show(s); });
      aquila.on('system', (s) => { r.events++; show(s); });
      aquila.on('waiting', ({ count }) => { r.paused = true; document.getElementById('state').textContent = 'Paused: ' + count + ' waiting'; });
      fetch('https://example.com/').then(() => (r.fetch = 'reached'), () => (r.fetch = 'blocked'));
      aquila.usage().then(() => (r.refused = 'allowed'), (e) => (r.refused = e.message));
      r.popup = window.open('https://example.com/') === null;
    </script>
  </body>
</html>
`;

/**
 * Extensions (T71): a user extension (made with "New extension", then edited) is reviewed, enabled and shown in the
 * panel; its sandboxed page gets live `system` values over postMessage, can't fetch without `network`, is refused a
 * method it didn't declare, can't open windows, sets a sidebar chip, and hears a session start waiting. Screenshots
 * dist/smoke-extension-review.png and dist/smoke-extension.png (native view composited).
 */
async function checkExtensions(
  win: BrowserWindow,
  ext: ExtensionHost,
  sessions: SessionManager,
  config: Config,
  outDir: string,
): Promise<string | null> {
  const project = config.projects.find((p) => !p.remote);
  if (!project) return 'extensions: no local project';
  const { id, dir } = ext.create('Smoke meter');
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    JSON.stringify({
      name: 'System meter',
      description: 'CPU and memory, live',
      glyph: '▥',
      permissions: ['system', 'sessions:status'],
      commands: [{ id: 'reset', title: 'Reset' }],
    }),
  );
  fs.writeFileSync(path.join(dir, 'index.html'), SMOKE_EXT_PAGE);
  ext.setEnabled(id, false);
  ext.reload(id);
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const shot = async (name: string) => {
    const [width, height] = win.getContentSize();
    const rect = { x: 0, y: 0, width, height };
    const views = ext.visibleViews().map((v) => ({ bounds: v.bounds, capture: () => v.webContents.capturePage() }));
    const img = await withViews(await win.webContents.capturePage(rect), rect, views);
    fs.writeFileSync(path.join(outDir, name), img.toPNG());
  };
  // Tab bar ⧉ opens the panel.
  const opened = await js<boolean>(`(() => {
    const b = [...document.querySelectorAll('.c-btn')].find((x) => x.querySelector('.c-btn__glyph')?.textContent === '⧉');
    b?.click();
    return !!b;
  })()`);
  if (!opened) return 'extensions: no ⧉ button in the tab bar';
  let review = false;
  for (let i = 0; i < 30 && !review; i++) {
    await wait(100);
    review = await js<boolean>(`!!document.querySelector('.c-ext__review .c-meta')`);
  }
  if (!review) return 'extensions: the permission review never showed';
  if (ext.contentsOf(id)) return 'extensions: the page ran before it was enabled';
  await wait(400);
  await shot('smoke-extension-review.png');
  // Enable from the review (the user's click).
  await js(`document.querySelector('.c-ext__actions .c-btn--primary')?.click()`);
  let wc = null as Electron.WebContents | null;
  for (let i = 0; i < 50 && !wc; i++) {
    await wait(100);
    wc = ext.contentsOf(id);
  }
  if (!wc) return 'extensions: enabling did not start the page';
  type R = { system: unknown; events: number; fetch: string; refused: string; popup: boolean; paused: boolean };
  const read = () => wc!.executeJavaScript('window.__smoke ?? null') as Promise<R | null>;
  let r: R | null = null;
  for (let i = 0; i < 80; i++) {
    await wait(100);
    r = await read().catch(() => null);
    if (r?.system && r.events >= 1 && r.fetch !== 'pending' && r.refused !== 'pending') break;
  }
  if (!r?.system) return 'extensions: no system values reached the page';
  if (r.events < 1) return 'extensions: no live system event';
  if (r.fetch !== 'blocked') return `extensions: fetch without network was ${r.fetch}`;
  if (!r.refused.includes('not allowed')) return `extensions: usage without permission was ${r.refused}`;
  if (!r.popup) return 'extensions: window.open was not denied';
  const chip = await js<string>(`document.querySelector('.c-ext-chips')?.textContent ?? ''`);
  if (!chip.includes('%')) return `extensions: no chip in the sidebar ("${chip}")`;
  // A session starts waiting: the page hears it.
  const shellId = sessions.create(config, project.id, 'shell').id;
  await wait(1200);
  sessions.write(shellId, SUMMON_WAITING);
  for (let i = 0; i < 60 && !r?.paused; i++) {
    await wait(100);
    r = await read().catch(() => null);
  }
  sessions.kill(shellId);
  if (!r?.paused) return 'extensions: the page did not hear a session start waiting';
  await wait(300);
  await shot('smoke-extension.png');
  // Floating window: its own window, faded, always on top, resized by the user; then back to the panel.
  ext.setFloat(id, true);
  let fw: BrowserWindow | null = null;
  for (let i = 0; i < 30 && !fw; i++) {
    await wait(100);
    fw = ext.floatWindow(id);
  }
  if (!fw) return 'extensions: no floating window';
  ext.setFloatStyle(id, { opacity: 0.7, onTop: true });
  if (Math.abs(fw.getOpacity() - 0.7) > 0.01) return `extensions: floating opacity ${fw.getOpacity()}`;
  if (!fw.isAlwaysOnTop()) return 'extensions: floating window not on top';
  fw.setContentSize(280, 200);
  await wait(400);
  const inner = await wc.executeJavaScript('[innerWidth, innerHeight]') as [number, number];
  if (inner[0] !== 280 || inner[1] !== 200) return `extensions: the page did not follow the window (${inner.join('×')})`;
  const floatingUi = await js<boolean>(`!!document.querySelector('.c-ext__review .c-range')`);
  if (!floatingUi) return 'extensions: the panel did not show the floating controls';
  await shot('smoke-extension-floating.png');
  fs.writeFileSync(path.join(outDir, 'smoke-extension-window.png'), (await wc.capturePage()).toPNG());
  ext.setFloat(id, false);
  for (let i = 0; i < 30 && ext.floatWindow(id); i++) await wait(100);
  if (ext.floatWindow(id)) return 'extensions: the floating window did not close on dock';
  await wait(400);
  if (ext.contentsOf(id) !== wc) return 'extensions: docking reloaded the page';
  if (!ext.visibleViews().some((v) => v.id === id)) return 'extensions: docked view not back in the panel';
  console.log(
    `[smoke] extensions: system ${JSON.stringify(r.system).slice(0, 80)}…, ${r.events} live events, fetch ${r.fetch}, usage refused, popup denied, chip "${chip}", paused on waiting, floated (70%, on top, 280×200) and docked`,
  );
  // The manifest asks for more after enabling (edited by hand, by Claude, a pull): off until approved again, with
  // what was added shown in the review.
  const manifestPath = path.join(dir, 'manifest.json');
  const approved = fs.readFileSync(manifestPath, 'utf8');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({ ...JSON.parse(approved), permissions: ['system', 'sessions:status', 'notify', 'network:evil.example.com'] }),
  );
  ext.reload(id);
  await wait(400);
  const grown = ext.list().find((x) => x.id === id);
  if (grown?.enabled || ext.contentsOf(id)) return 'extensions: new permissions were used without asking again';
  if (grown?.added?.network.join() !== 'evil.example.com' || grown.added.permissions.join() !== 'notify')
    return `extensions: added permissions not reported (${JSON.stringify(grown?.added)})`;
  const warned = await js<string>(`document.querySelector('.c-ext__review [data-tone=warn]')?.textContent ?? ''`);
  if (!warned.includes('evil.example.com')) return 'extensions: the review does not say what was added';
  await shot('smoke-extension-permissions-changed.png');
  fs.writeFileSync(manifestPath, approved);
  ext.reload(id);
  await wait(300);
  if (!ext.list().find((x) => x.id === id)?.enabled) return 'extensions: back to the approved manifest, still off';
  console.log('[smoke] extensions: grown manifest turned it off with the added permissions shown; approved one back on');
  // Close the panel: the view hides (suspended later).
  await js(`[...document.querySelectorAll('.c-btn')].find((x) => x.querySelector('.c-btn__glyph')?.textContent === '⧉')?.click()`);
  await wait(300);
  if (ext.visibleViews().length) return 'extensions: the view stayed on screen after the panel closed';
  ext.setEnabled(id, false);
  fs.rmSync(dir, { recursive: true, force: true });
  ext.scan();
  return null;
}

const processAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Run slot (T60): a fixture server (that starts a child of its own, like vite → esbuild) runs from a temp folder
 * under the first local project, shown in the panel opened from ⌘K: green dot, its log live, "Open in preview";
 * it answers on its PORT; Stop turns the dot into a ring and leaves no process behind. The project's own commands
 * are never started.
 */
async function checkRunSlot(
  win: BrowserWindow,
  runs: RunManager,
  config: Config,
  outDir: string,
): Promise<string | null> {
  // The project smoke's shells run in (on screen now).
  const project = config.projects[0];
  if (!project || project.remote) return 'run slot: the first project is not local';
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'aquila-run-'));
  fs.writeFileSync(
    path.join(dir, 'server.js'),
    `const http = require('http');
     const { spawn } = require('child_process');
     const kid = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', env: { ELECTRON_RUN_AS_NODE: '1' } });
     http.createServer((q, s) => s.end('aquila-run-ok')).listen(Number(process.env.PORT), () => {
       console.log('kid ' + kid.pid);
       console.log('  \\x1b[32m➜\\x1b[39m  Local: http://localhost:' + process.env.PORT + '/');
     });`,
  );
  const port = 45000 + Math.floor(Math.random() * 1000);
  const name = 'smoke-fixture';
  const command = `ELECTRON_RUN_AS_NODE=1 "${process.execPath}" server.js`;
  const id = runId(project.id, undefined, name);
  // Listed with its command, as if configured: a stopped run that isn't a project command leaves the list.
  const info = () => runs.list(project.id, undefined, [{ name, command }]).runs.find((r) => r.id === id);
  // The panel of the project's own dir (no worktree); main lists a live run even when it isn't a configured command.
  await runs.start({ projectId: project.id, name, command, cwd: dir, port });
  for (let i = 0; i < 100 && !info()?.url; i++) await wait(100);
  const up = info();
  let body = '';
  try {
    body = await (await fetch(`http://localhost:${port}/`)).text();
  } catch (e) {
    body = (e as Error).message;
  }
  const kid = Number(/kid (\d+)/.exec(runs.log(id))?.[1]);

  const label = translator(config.language)('run.toggle');
  const opened = await paletteRun(win, label, true);
  await wait(600);
  // Several commands → pick the fixture's row.
  await js(
    `[...document.querySelectorAll('.c-runs__item')].find((b) => b.textContent?.includes(${JSON.stringify(name)}))?.click()`,
  );
  let ui = { dot: '', log: '', preview: false };
  const readUi = () =>
    js<typeof ui>(`({
      dot: document.querySelector('.c-run .c-run__state .c-dot')?.getAttribute('data-status') ?? '',
      log: document.querySelector('.c-run .xterm-rows')?.textContent ?? '',
      preview: [...document.querySelectorAll('.c-run .c-panel__bar button')].some((b) => b.title?.startsWith('http://localhost:${port}')),
    })`);
  for (let i = 0; i < 30 && !(ui.dot === 'live' && ui.log.includes('Local:')); i++) {
    await wait(100);
    ui = await readUi();
  }
  fs.writeFileSync(path.join(outDir, 'smoke-run.png'), (await win.webContents.capturePage()).toPNG());

  await runs.stop(id);
  const down = info();
  const leftover = !!kid && processAlive(kid);
  let after = await readUi();
  // In the panel it's not a project command: once stopped it leaves the list (the project's own run shows again).
  for (let i = 0; i < 20 && after.dot === 'live'; i++) {
    await wait(100);
    after = await readUi();
  }
  fs.writeFileSync(path.join(outDir, 'smoke-run-stopped.png'), (await win.webContents.capturePage()).toPNG());
  await js(`document.querySelector('.c-run .c-panel__actions button')?.click()`);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(
    `[smoke] run slot: ${up?.state} at ${up?.url ?? 'no address'} (PORT ${up?.port}) answered "${body}"; panel dot ${ui.dot}, log has address ${ui.log.includes('Local:')}, open in preview ${ui.preview}; stop → ${down?.state}, dot ${after.dot}, child left: ${leftover}`,
  );
  if (up?.state !== 'running' || up.url !== `http://localhost:${port}/`)
    return `run slot: not up (${up?.state}, ${up?.url})`;
  if (body !== 'aquila-run-ok') return `run slot: server did not answer (${body})`;
  if (!kid) return 'run slot: fixture child pid not printed';
  if (!opened) return 'run slot: ⌘K has no run panel action';
  if (ui.dot !== 'live') return `run slot: panel dot is "${ui.dot}", not live`;
  if (!ui.log.includes('Local:')) return 'run slot: the log pane does not show the output';
  if (!ui.preview) return 'run slot: no "Open in preview" for the printed address';
  if (down?.alive || down?.state !== 'exited') return `run slot: still ${down?.state} after Stop`;
  if (after.dot === 'live') return 'run slot: the panel still shows it running after Stop';
  if (leftover) return 'run slot: a process was left behind after Stop';
  return null;
}

/** A page with a fake React fiber on its button, so the component lookup is exercised without React. */
const PICK_PAGE = `data:text/html,${encodeURIComponent(`<!doctype html><title>pick</title>
<body style="margin:0;font:14px sans-serif"><main class="shop"><button id="save" class="btn primary"
style="margin:40px;padding:8px 16px;background:rgb(47,111,237);color:white;border:0">Save order</button></main>
<script>
function SaveButton() {}
function Cart() {}
document.getElementById('save')['__reactFiber$smoke'] = { type: 'button', return: { type: SaveButton,
  _debugSource: { fileName: 'src/Save.tsx', lineNumber: 12 }, return: { type: Cart, return: null } } };
</script>`)}`;

/**
 * In-app preview (T33): a native view loads a page, Select mode resolves with the clicked element (selector,
 * component chain, computed style) and a cropped screenshot on disk; cancel resolves with null.
 */
async function checkPreviewPick(previews: PreviewViews): Promise<string | null> {
  previews.set('app', { url: PICK_PAGE, bounds: { x: 600, y: 120, width: 480, height: 320 }, width: 0 });
  try {
    let ready = false;
    for (let i = 0; i < 50 && !ready; i++) {
      await wait(100);
      ready = await previews.hover('app', '#save');
    }
    if (!ready) return 'preview: the page never loaded';
    const picking = previews.pick('app');
    await wait(300);
    await previews.hover('app', '#save', true);
    const pick = await Promise.race([picking, wait(3000).then(() => 'timeout' as const)]);
    if (pick === 'timeout' || !pick) return `preview: pick did not resolve (${String(pick)})`;
    console.log(
      `[smoke] preview pick: ${pick.selector} ${pick.components.join(' ← ')} (${pick.source ?? '-'})`,
    );
    if (pick.selector !== '#save') return `preview: selector ${pick.selector}`;
    if (pick.text !== 'Save order') return `preview: text ${pick.text}`;
    if (pick.components.join(',') !== 'SaveButton,Cart')
      return `preview: components ${pick.components.join(',')}`;
    if (pick.source !== 'src/Save.tsx:12') return `preview: source ${pick.source}`;
    if (pick.styles['background-color'] !== 'rgb(47, 111, 237)') return 'preview: computed style missing';
    if (!pick.imagePath || !fs.existsSync(pick.imagePath) || fs.statSync(pick.imagePath).size < 100)
      return 'preview: no screenshot';
    fs.rmSync(pick.imagePath, { force: true });
    // Designer compare (T62): the whole view as a PNG, on disk and inline.
    const shot = await previews.capture('app');
    if (!shot || shot.width < 100 || !shot.dataUrl.startsWith('data:image/png') || !fs.existsSync(shot.path))
      return `preview: capture failed (${shot ? `${shot.width}x${shot.height}` : 'null'})`;
    console.log(`[smoke] preview capture: ${shot.width}x${shot.height}`);
    fs.rmSync(shot.path, { force: true });
    const cancelled = previews.pick('app');
    await wait(300);
    previews.cancelPick('app');
    const none = await Promise.race([cancelled, wait(3000).then(() => 'timeout' as const)]);
    if (none !== null) return `preview: cancel resolved with ${JSON.stringify(none)}`;
    return null;
  } finally {
    previews.set('app', null);
  }
}

function press(win: BrowserWindow, keyCode: string, modifiers: Electron.InputEvent['modifiers']) {
  for (const type of ['keyDown', 'keyUp'] as const)
    win.webContents.sendInputEvent({ type, keyCode, modifiers });
}

/**
 * ⌘K, then click the palette item whose text is `label` (or starts with it). Polls instead of a fixed wait (a busy
 * machine renders late) and presses ⌘K again if the palette did not open. Returns whether the item was clicked.
 */
async function paletteRun(win: BrowserWindow, label: string, prefix = false): Promise<boolean> {
  // The palette runs its command in requestAnimationFrame, which an occluded window doesn't fire.
  win.show();
  win.focus();
  const match = prefix
    ? `el.textContent?.startsWith(${JSON.stringify(label)})`
    : `el.textContent === ${JSON.stringify(label)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    press(win, 'K', ['meta']);
    for (let i = 0; i < 20; i++) {
      await wait(150);
      const state: 'clicked' | 'open' | 'closed' = await win.webContents.executeJavaScript(`(() => {
        const items = [...document.querySelectorAll('.c-palette__item')];
        const item = items.find((el) => ${match});
        if (item) { item.click(); return 'clicked'; }
        return items.length ? 'open' : 'closed';
      })()`);
      if (state === 'clicked') return true;
      if (state === 'closed' && i >= 6) break; // not open after ~1s: press ⌘K again
    }
  }
  return false;
}

/** Per mounted terminal: on screen, and rendering with WebGL (its canvas) or the DOM renderer (`.xterm-rows`). */
async function terminals(win: BrowserWindow): Promise<{ visible: boolean; webgl: boolean }[]> {
  return win.webContents.executeJavaScript(`[...document.querySelectorAll('.term-host')].map((h) => ({
    visible: !h.hidden,
    webgl: !!h.querySelector('.xterm-screen canvas') && !h.querySelector('.xterm-rows'),
  }))`);
}

/**
 * Two shells, switch tabs, split: every terminal on screen has WebGL, at most MAX_GPU have it (hidden ones keep it
 * up to that cap, see gpuPool). Returns an error or null.
 * Leaves the app split with two shells (the screenshot).
 */
async function checkGpuFollowsScreen(win: BrowserWindow): Promise<string | null> {
  const expect = async (step: string, visible: number) => {
    const ts = await terminals(win);
    console.log(`[smoke] ${step}: ${JSON.stringify(ts)}`);
    if (ts.filter((t) => t.visible).length !== visible)
      return `${step}: expected ${visible} terminal(s) on screen`;
    if (ts.some((t) => t.visible && !t.webgl)) return `${step}: a terminal on screen has no WebGL`;
    if (ts.filter((t) => t.webgl).length > MAX_GPU) return `${step}: more than ${MAX_GPU} WebGL contexts`;
    return null;
  };
  press(win, 'T', ['meta', 'alt']);
  await wait(1500);
  const one = await expect('one shell', 1);
  if (one) return one;
  press(win, 'T', ['meta', 'alt']);
  await wait(1500);
  const two = await expect('second shell, first hidden', 1);
  if (two) return two;
  await win.webContents.executeJavaScript(`document.querySelector('.c-tab')?.click()`);
  await wait(800);
  const back = await expect('back to the first tab', 1);
  if (back) return back;
  const firstWasShown = (await terminals(win))[0]?.visible;
  if (!firstWasShown) return 'clicking the first tab did not show the first terminal';
  press(win, 'D', ['meta']);
  await wait(500);
  press(win, 'T', ['meta', 'alt']);
  await wait(1500);
  return expect('split: two on screen, one hidden', 2);
}

/**
 * Panel layout (T49): at 1440 px with Changes (side-by-side) and Preview both open, nothing scrolls sideways, the
 * sidebar footer is whole, and the terminal keeps its minimum width. Screenshot, then both panels close again.
 */
async function checkPanelLayout(win: BrowserWindow, outDir: string): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  const [w0, h0] = win.getContentSize();
  win.setContentSize(1440, 900);
  win.show();
  win.focus();
  const mod: Electron.InputEvent['modifiers'] =
    process.platform === 'win32' ? ['control', 'shift'] : ['meta', 'shift'];
  press(win, 'G', mod);
  press(win, 'P', mod);
  await wait(600);
  // Side-by-side diffs: the wide Changes panel.
  await js(
    `[...(document.querySelector('.app > .c-panel')?.querySelectorAll('[role=radiogroup]') ?? [])].at(-1)?.querySelector('[role=radio]:last-child')?.click()`,
  );
  await wait(600);
  type Box = { l: number; r: number; w: number; b: number };
  const m: {
    doc: number;
    view: number;
    app: number;
    panels: Box[];
    main: Box | null;
    sidebar: Box | null;
    foot: Box | null;
    footScroll: number;
    footClient: number;
    vh: number;
  } = await js(`(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), b: Math.round(r.bottom) }; };
    const foot = document.querySelector('.c-sidebar__foot');
    return {
      doc: document.documentElement.scrollWidth, view: document.documentElement.clientWidth,
      app: document.querySelector('.app').scrollWidth,
      panels: [...document.querySelectorAll('.app > .c-panel')].map(box),
      main: box(document.querySelector('.app__main')),
      sidebar: box(document.querySelector('.c-sidebar')),
      foot: box(foot), footScroll: foot?.scrollWidth ?? 0, footClient: foot?.clientWidth ?? 0,
      vh: window.innerHeight,
    };
  })()`);
  fs.writeFileSync(path.join(outDir, 'smoke-panels.png'), (await win.webContents.capturePage()).toPNG());
  console.log(`[smoke] panels: ${JSON.stringify(m)}`);
  // Drag the Preview's left edge 160px right: it narrows down to its minimum, the width is remembered, and a
  // double-click on the edge forgets it again.
  const edge: { x: number; y: number } | null = await js(`(() => {
    const r = document.querySelector('.c-preview > .c-resize')?.getBoundingClientRect();
    return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
  })()`);
  let dragged: { w: number; min: number; stored: string | null; pinned: boolean } | null = null;
  let reset: string | null = 'not tried';
  if (edge) {
    const mouse = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', x: number) =>
      win.webContents.sendInputEvent({
        type,
        x,
        y: edge.y,
        button: 'left',
        clickCount: 1,
        modifiers: type === 'mouseMove' ? ['leftbuttondown'] : [],
      });
    mouse('mouseDown', edge.x);
    for (let dx = 20; dx <= 160; dx += 20) {
      mouse('mouseMove', edge.x + dx);
      await wait(30);
    }
    mouse('mouseUp', edge.x + 160);
    await wait(300);
    dragged = await js(`(() => {
      const p = document.querySelector('.c-preview');
      return { w: Math.round(p.getBoundingClientRect().width), min: parseFloat(getComputedStyle(p).minWidth),
        stored: localStorage.getItem('aquila.panel.preview'), pinned: p.hasAttribute('data-pinned') };
    })()`);
    const at: number = await js(
      `Math.round(document.querySelector('.c-preview > .c-resize').getBoundingClientRect().left + 4)`,
    );
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at, y: edge.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at, y: edge.y, button: 'left', clickCount: 1 });
    win.webContents.sendInputEvent({ type: 'mouseDown', x: at, y: edge.y, button: 'left', clickCount: 2 });
    win.webContents.sendInputEvent({ type: 'mouseUp', x: at, y: edge.y, button: 'left', clickCount: 2 });
    await wait(300);
    reset = await js(`localStorage.getItem('aquila.panel.preview')`);
  }
  console.log(`[smoke] panel drag: ${JSON.stringify(dragged)}, after double-click: ${JSON.stringify(reset)}`);
  press(win, 'G', mod);
  press(win, 'P', mod);
  await wait(400);
  win.setContentSize(w0, h0);
  await wait(300);
  if (m.panels.length !== 2)
    return `panel layout: ${m.panels.length} panels open, expected Changes + Preview`;
  if (m.doc > m.view || m.app > m.view)
    return `panel layout: page scrolls sideways (${m.doc}/${m.app} > ${m.view})`;
  if (m.foot && m.sidebar && (m.foot.r > m.sidebar.r || m.footScroll > m.footClient || m.foot.b > m.vh))
    return 'panel layout: sidebar footer is clipped';
  if (!m.main || m.main.w < 480) return `panel layout: terminal is ${m.main?.w ?? 0}px wide, expected ≥ 480`;
  if (!dragged) return 'panel layout: Preview has no resize handle';
  if (dragged.w !== dragged.min || dragged.stored !== String(dragged.min) || !dragged.pinned)
    return `panel layout: dragging the Preview edge left it ${dragged.w}px (stored ${dragged.stored}), expected ${dragged.min}`;
  if (reset !== null) return `panel layout: double-click did not reset the Preview width (still ${reset})`;
  return null;
}

/** Left/width of each visible pane, in px. */
async function paneBoxes(win: BrowserWindow): Promise<{ x: number; w: number }[]> {
  return win.webContents.executeJavaScript(`[...document.querySelectorAll('.c-split > .c-pane')].map((p) => {
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left), w: Math.round(r.width) };
  })`);
}

/**
 * T22, on the split smoke leaves: drag the divider with real mouse input, nudge it with ⌥⇧⌘←, zoom with ⇧⌘↩ (one
 * terminal fills the stage) and back. Saves smoke-panes.png (resized) and smoke-zoom.png. Returns an error or null.
 */
async function checkPaneResizeAndZoom(win: BrowserWindow, outDir: string): Promise<string | null> {
  const handle: { x: number; y: number } | null = await win.webContents.executeJavaScript(`(() => {
    const d = document.querySelector('.c-split__divider[data-dir="row"]');
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  if (!handle) return 'panes: no divider between the two panes';
  const before = await paneBoxes(win);
  const to = handle.x - Math.round(before[0].w * 0.3);
  const mouse = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', x: number) =>
    win.webContents.sendInputEvent({
      type,
      x,
      y: handle.y,
      button: 'left',
      clickCount: 1,
      // A drag: the button is held during the moves (without this Chromium sees a hover and drops the capture).
      modifiers: type === 'mouseMove' && x !== handle.x ? ['leftbuttondown'] : [],
    });
  mouse('mouseMove', handle.x);
  mouse('mouseDown', handle.x);
  for (let i = 1; i <= 5; i++) {
    mouse('mouseMove', Math.round(handle.x + ((to - handle.x) * i) / 5));
    await wait(30);
  }
  mouse('mouseUp', to);
  await wait(400);
  const dragged = await paneBoxes(win);
  console.log(`[smoke] panes: ${JSON.stringify(before)} → dragged ${JSON.stringify(dragged)}`);
  if (!(dragged[0].w < before[0].w * 0.8)) return 'panes: dragging the divider did not resize the left pane';
  press(win, 'Right', ['meta', 'alt', 'shift']);
  await wait(300);
  const nudged = await paneBoxes(win);
  if (!(nudged[0].w > dragged[0].w)) return 'panes: ⌥⇧⌘→ did not move the divider';
  fs.writeFileSync(path.join(outDir, 'smoke-panes.png'), (await win.webContents.capturePage()).toPNG());
  press(win, 'Enter', ['meta', 'shift']);
  await wait(500);
  const zoomed = await paneBoxes(win);
  const onScreen = (await terminals(win)).filter((t) => t.visible).length;
  console.log(`[smoke] zoomed: ${JSON.stringify(zoomed)}, terminals on screen: ${onScreen}`);
  if (zoomed.length !== 1 || zoomed[0].w <= nudged[0].w + nudged[1].w - 2 || onScreen !== 1)
    return 'panes: ⇧⌘↩ did not zoom the focused pane to the whole stage';
  fs.writeFileSync(path.join(outDir, 'smoke-zoom.png'), (await win.webContents.capturePage()).toPNG());
  press(win, 'Enter', ['meta', 'shift']);
  await wait(500);
  const back = await paneBoxes(win);
  if (back.length !== 2 || Math.abs(back[0].w - nudged[0].w) > 1)
    return 'panes: zoom did not toggle back to the same sizes';
  return null;
}

/**
 * T37, on the split smoke leaves (macOS only): ⇧⌘F hides the sidebar, tab bar and the other pane (one terminal
 * fills the window under a title band); Esc doesn't leave (it's the CLI's); ⇧⌘F brings the split back as it was.
 * Saves smoke-fullscreen.png. Returns an error or null.
 */
async function checkFullscreen(win: BrowserWindow, outDir: string): Promise<string | null> {
  if (process.platform !== 'darwin') return null;
  const chrome = (): Promise<{ sidebar: boolean; tabbar: boolean; titlebar: boolean }> =>
    win.webContents.executeJavaScript(`({
      sidebar: !!document.querySelector('.c-sidebar'),
      tabbar: !!document.querySelector('.c-tabbar'),
      titlebar: !!document.querySelector('.c-titlebar'),
    })`);
  const before = await paneBoxes(win);
  press(win, 'F', ['meta', 'shift']);
  await wait(500);
  const on = await chrome();
  const panes = await paneBoxes(win);
  const onScreen = (await terminals(win)).filter((t) => t.visible).length;
  console.log(
    `[smoke] full window: ${JSON.stringify(on)}, panes ${JSON.stringify(panes)}, terminals ${onScreen}`,
  );
  if (on.sidebar || on.tabbar || !on.titlebar)
    return 'full window: ⇧⌘F did not swap sidebar + tab bar for the title band';
  if (panes.length !== 1 || panes[0].x !== 0 || onScreen !== 1)
    return 'full window: the focused pane does not fill the window alone';
  fs.writeFileSync(path.join(outDir, 'smoke-fullscreen.png'), (await win.webContents.capturePage()).toPNG());
  press(win, 'Escape', []);
  await wait(200);
  if (!(await chrome()).titlebar) return 'full window: Esc left it (Esc belongs to the CLI)';
  press(win, 'F', ['meta', 'shift']);
  await wait(500);
  const off = await chrome();
  const back = await paneBoxes(win);
  if (!off.sidebar || !off.tabbar || off.titlebar) return 'full window: ⇧⌘F did not bring the workspace back';
  if (back.length !== before.length || Math.abs(back[0].w - before[0].w) > 1)
    return 'full window: the split did not come back with the same sizes';
  return null;
}

/**
 * T40, on the focused shell: a paste with `ESC[201~` and Ctrl+C in it reaches the pty without them (it can't end
 * bracketed paste early); ⌘F (Ctrl+Shift+F on Windows) opens the find bar with focus in it, typing finds the pasted
 * text in the scrollback, Esc closes the bar and gives the terminal its keyboard back. Saves smoke-find.png.
 */
async function checkPasteAndFind(win: BrowserWindow, outDir: string): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  let written = '';
  const record = (_e: unknown, { data }: { id: string; data: string }) => (written += data);
  ipcMain.on(IPC.sessionWrite, record);
  try {
    const pasted: boolean = await js(`(() => {
      const ta = document.activeElement?.classList.contains('xterm-helper-textarea')
        ? document.activeElement
        : document.querySelector('.term-host:not([hidden]) .xterm-helper-textarea');
      if (!ta) return false;
      ta.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', "echo 'AQFIND AQFIND\\x1b[201~\\x03'");
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      return true;
    })()`);
    if (!pasted) return 'paste: no terminal to paste into';
    await wait(200);
    console.log(`[smoke] paste wrote ${JSON.stringify(written)}`);
    if (!written.includes("echo 'AQFIND AQFIND[201~'")) return 'paste: the pasted text did not reach the pty';
    if (written.includes('\x03') || written.includes("\x1b[201~'"))
      return 'paste: control characters from the clipboard reached the pty';
    press(win, 'Return', []);
    await wait(500);
  } finally {
    ipcMain.removeListener(IPC.sessionWrite, record);
  }

  press(win, 'F', process.platform === 'win32' ? ['control', 'shift'] : ['meta']);
  await wait(400);
  const opened: { bar: boolean; focused: boolean } = await js(`({
    bar: !!document.querySelector('.c-term-find'),
    focused: !!document.activeElement?.classList.contains('c-term-find__input'),
  })`);
  if (!opened.bar || !opened.focused)
    return `find: the bar did not open with focus (${JSON.stringify(opened)})`;
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await dbg.sendCommand('Input.insertText', { text: 'AQFIND' });
  await wait(600);
  const count: string = await js(`document.querySelector('.c-term-find__count')?.textContent ?? ''`);
  console.log(`[smoke] find "AQFIND": ${count}`);
  const m = /^(\d+)\/(\d+)$/.exec(count);
  if (!m || Number(m[2]) < 2) return `find: expected matches for the pasted text, got "${count}"`;
  fs.writeFileSync(path.join(outDir, 'smoke-find.png'), (await win.webContents.capturePage()).toPNG());
  press(win, 'Escape', []);
  await wait(300);
  const closed: { bar: boolean; terminal: boolean } = await js(`({
    bar: !!document.querySelector('.c-term-find'),
    terminal: !!document.activeElement?.classList.contains('xterm-helper-textarea'),
  })`);
  if (closed.bar || !closed.terminal)
    return `find: Esc did not close the bar back to the terminal (${JSON.stringify(closed)})`;
  return null;
}

/**
 * T42, on the focused shell: quick select stays useful while output keeps coming. A path printed after it opened gets
 * a new label; the labels already shown keep theirs. Esc closes it and gives the terminal its keyboard back.
 */
async function checkQuickSelectFollows(win: BrowserWindow): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  // `aq/%s` on the command line is not a path; only the printed `aq/one`, then `aq/two` a second later, are.
  const typed: boolean = await js(`(() => {
    const ta = document.activeElement;
    if (!ta?.classList.contains('xterm-helper-textarea')) return false;
    const dt = new DataTransfer();
    dt.setData('text/plain', "clear; printf 'aq/%s\\\\n' one; sleep 1.2; printf 'aq/%s\\\\n' two");
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
  if (!typed) return 'quick select: the shell does not have focus';
  press(win, 'Return', []);
  await wait(500);
  press(win, 'E', process.platform === 'win32' ? ['control', 'shift'] : ['meta', 'shift']);
  await wait(200);
  const labels = () =>
    js<string[]>(`[...document.querySelectorAll('.c-term-hint__label')].map((e) => e.textContent ?? '')`);
  const before = await labels();
  await wait(1500);
  const after = await labels();
  console.log(`[smoke] quick select labels ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  press(win, 'Escape', []);
  await wait(300);
  const terminal: boolean = await js(`!!document.activeElement?.classList.contains('xterm-helper-textarea')`);
  if (!before.length) return 'quick select: no label for the printed path';
  if (after.length !== before.length + 1 || !before.every((l) => after.includes(l)))
    return `quick select: output after opening did not get a new label (${JSON.stringify({ before, after })})`;
  if (!terminal) return 'quick select: Esc did not give the terminal its keyboard back';
  return null;
}

/**
 * T43: double-click the focused tab's title, type a name, Enter. The tab and the pane head show it, the saved tabs
 * carry it, and the keyboard goes back to the terminal. Cleared afterwards so later checks see the usual tabs.
 */
async function checkRename(win: BrowserWindow, s: SessionManager, outDir: string): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  const name = 'Smoke 제목';
  const opened: boolean = await js(`(() => {
    const title = document.querySelector('.c-tab[aria-selected="true"] .c-tab__title');
    title?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return !!title;
  })()`);
  if (!opened) return 'rename: no selected tab title';
  await wait(200);
  const editing: boolean = await js(`document.activeElement?.matches('.c-tab input') ?? false`);
  if (!editing) return 'rename: double-click did not open the title for editing';
  await win.webContents.insertText(name);
  press(win, 'Return', []);
  await wait(400);
  const shown: { tab: string; head: string; terminal: boolean } = await js(`({
    tab: document.querySelector('.c-tab[aria-selected="true"] .c-tab__title')?.textContent ?? '',
    head: [...document.querySelectorAll('.c-pane[data-focused="true"] .c-pane__title')].map((e) => e.textContent).join(),
    terminal: !!document.activeElement?.classList.contains('xterm-helper-textarea'),
  })`);
  fs.writeFileSync(path.join(outDir, 'smoke-rename.png'), (await win.webContents.capturePage()).toPNG());
  const saved = s.tabs().some((t) => t.title === name);
  console.log(`[smoke] rename: tab "${shown.tab}", pane head "${shown.head}", saved ${saved}`);
  const id = s.active;
  if (id) s.rename(id, '');
  await wait(200);
  // ⌘K → "Rename session" opens the same input, and it keeps the focus the palette hands back.
  press(win, 'K', process.platform === 'win32' ? ['control'] : ['meta']);
  await wait(300);
  await win.webContents.insertText('세션 이름 바꾸기');
  await wait(200);
  press(win, 'Return', []);
  await wait(500);
  const fromPalette: boolean = await js(`document.activeElement?.matches('.c-tab input') ?? false`);
  press(win, 'Escape', []);
  await wait(300);
  // A tab that isn't selected: the first click selects it, the double-click opens its title.
  const other: boolean = await js(`(() => {
    const title = document.querySelector('.c-tab[aria-selected="false"] .c-tab__title');
    if (!title) return false;
    title.setAttribute('data-smoke-rename', '');
    title.click();
    return true;
  })()`);
  await wait(250);
  await js(
    `document.querySelector('[data-smoke-rename]')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`,
  );
  await wait(500);
  const otherEditing: boolean = await js(`document.activeElement?.matches('.c-tab input') ?? false`);
  press(win, 'Escape', []);
  await wait(300);
  const closed: boolean = await js(`!document.querySelector('.c-tab input')`);
  console.log(
    `[smoke] rename: from ⌘K ${fromPalette}, other tab ${other && otherEditing}, Esc closes ${closed}`,
  );
  if (!fromPalette) return 'rename: ⌘K "Rename session" did not leave the title input focused';
  if (other && !otherEditing) return 'rename: double-click on another tab did not keep its input focused';
  if (!closed) return 'rename: Esc did not close the input';
  if (shown.tab !== name) return `rename: the tab reads "${shown.tab}"`;
  if (!shown.head.includes(name)) return `rename: the pane head reads "${shown.head}"`;
  if (!saved) return 'rename: the title is not in the saved tabs';
  if (!shown.terminal) return 'rename: Enter did not give the terminal its keyboard back';
  return null;
}

/**
 * T43: a UserPromptSubmit body as Claude 2.1.329 posts it names the focused tab; a later prompt or a slash command
 * doesn't, a user title wins and clearing it goes back to the prompt.
 */
/**
 * T52: the focused shell reports waiting on `Bash: rm -rf dist` over OSC 7501. The project row gets the reason line,
 * marked risky, and the tab gets the warning mark and the reason in its tooltip. Screenshot, then back to idle.
 */
async function checkWaitingReason(
  win: BrowserWindow,
  s: SessionManager,
  outDir: string,
): Promise<string | null> {
  const id = s.active;
  if (!id) return 'waiting reason: no focused tab';
  s.write(id, RISKY_WAITING);
  type Seen = { reason: string; risk: boolean; mark: boolean; tooltip: string };
  const look = (): Promise<Seen> =>
    win.webContents.executeJavaScript(`(() => {
      const r = document.querySelector('.c-sidebar .c-reason');
      const tab = document.querySelector('.c-tab[aria-selected="true"]');
      return {
        reason: r?.textContent ?? '',
        risk: r?.getAttribute('data-risk') === 'true',
        mark: !!tab?.querySelector('.c-risk'),
        tooltip: tab?.getAttribute('title') ?? '',
      };
    })()`) as Promise<Seen>;
  let seen = await look();
  for (let i = 0; i < 30 && !seen.reason.includes('rm -rf dist'); i++) {
    await wait(100);
    seen = await look();
  }
  fs.writeFileSync(path.join(outDir, 'smoke-reason.png'), (await win.webContents.capturePage()).toPNG());
  s.write(id, RISKY_DONE);
  await wait(500);
  const cleared: boolean = await win.webContents.executeJavaScript(
    `!document.querySelector('.c-sidebar .c-reason')`,
  );
  console.log(
    `[smoke] waiting reason: row "${seen.reason}", risky ${seen.risk}, tab mark ${seen.mark}, tooltip "${seen.tooltip}", cleared ${cleared}`,
  );
  if (!seen.reason.includes('rm -rf dist'))
    return 'waiting reason: the project row did not show the permission summary';
  if (!seen.risk || !seen.mark) return 'waiting reason: rm -rf was not marked as destructive';
  if (!seen.tooltip.includes('rm -rf dist')) return 'waiting reason: the tab tooltip has no reason';
  if (!cleared) return 'waiting reason: the line stayed after the session stopped waiting';
  return null;
}

/**
 * T58: every shell runs a turn and finishes. The ones on screen never join the review queue; the hidden ones do.
 * Clicking the first entry shows that tab and removes only it. Screenshot, then the shells go back to idle.
 */
async function checkReviewQueue(
  win: BrowserWindow,
  s: SessionManager,
  outDir: string,
): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  const ids = s.ids();
  const hidden = (await terminals(win)).filter((t) => !t.visible).length;
  if (!hidden) return 'review queue: no hidden tab to finish in the background';
  for (const id of ids) s.write(id, TURN_DONE);
  const count = () => js<number>(`document.querySelectorAll('.c-sidebar .c-queue').length`);
  let before = await count();
  for (let i = 0; i < 40 && before < hidden; i++) {
    await wait(100);
    before = await count();
  }
  fs.writeFileSync(path.join(outDir, 'smoke-review.png'), (await win.webContents.capturePage()).toPNG());
  const title = await js<string>(`document.querySelector('.c-sidebar .c-queue__title')?.textContent ?? ''`);
  await js(`document.querySelector('.c-sidebar .c-queue')?.click()`);
  await wait(500);
  const after = await count();
  const selected = await js<string>(
    `document.querySelector('.c-tab[aria-selected="true"]')?.textContent ?? ''`,
  );
  for (const id of ids) s.write(id, RISKY_DONE);
  console.log(
    `[smoke] review queue: ${hidden} hidden, ${before} queued, "${title}" shown → ${after} left (tab "${selected}")`,
  );
  if (before !== hidden) return `review queue: ${before} entries for ${hidden} hidden finished tabs`;
  if (after !== before - 1) return 'review queue: showing one entry did not remove only that one';
  return null;
}

async function checkPromptTitle(win: BrowserWindow, s: SessionManager): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  const id = s.active;
  if (!id) return 'prompt title: no focused tab';
  const body = (prompt: string) =>
    JSON.stringify({
      session_id: '0f8fad5b-d9cb-469f-a165-70867728950e',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/tmp',
      permission_mode: 'default',
      hook_event_name: 'UserPromptSubmit',
      prompt,
      prompt_id: 'p1',
    });
  const post = (prompt: string) => {
    const hook = readHookBody(body(prompt));
    if (hook) s.onHook(id, hook);
  };
  const tab = () =>
    js<string>(`document.querySelector('.c-tab[aria-selected="true"] .c-tab__title')?.textContent ?? ''`);
  post('/model');
  await wait(200);
  const afterSlash = await tab();
  post('로그인 버그 고쳐줘\n자세한 내용은 아래');
  await wait(300);
  const first = await tab();
  post('Second prompt');
  await wait(300);
  const second = await tab();
  s.rename(id, 'Mine');
  await wait(300);
  const renamed = await tab();
  s.rename(id, '');
  await wait(300);
  const reset = await tab();
  const saved = s.tabs().some((t) => t.prompt === '로그인 버그 고쳐줘');
  console.log(
    `[smoke] prompt title: after /model "${afterSlash}", first "${first}", second "${second}", renamed "${renamed}", reset "${reset}", saved ${saved}`,
  );
  if (afterSlash === '로그인 버그 고쳐줘') return 'prompt title: a slash command named the tab';
  if (first !== '로그인 버그 고쳐줘')
    return `prompt title: the first prompt did not name the tab ("${first}")`;
  if (second !== first) return `prompt title: a later prompt renamed the tab ("${second}")`;
  if (renamed !== 'Mine') return `prompt title: a user title did not win ("${renamed}")`;
  if (reset !== first)
    return `prompt title: clearing the user title did not go back to the prompt ("${reset}")`;
  if (!saved) return 'prompt title: the prompt is not in the saved tabs';
  return null;
}

/**
 * T42, on the focused shell: right-click → Paste. The native menu can't be clicked from here, so for this check the
 * menu handler answers "paste" itself (the items the terminal asked for are checked). Text goes through the safe
 * paste (no `ESC[201~`), an image goes in as a temp PNG path. The user's clipboard is put back afterwards.
 */
async function checkMenuPaste(win: BrowserWindow): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  // Copied out now: the items' data must outlive our own writes.
  const saved = await Promise.all(
    (await clipboard.read()).map(
      async (item) =>
        new ClipboardItem(
          Object.fromEntries(
            await Promise.all(item.types.map(async (t) => [t, await item.getType(t)] as const)),
          ),
        ),
    ),
  ).catch(() => [] as ClipboardItem[]);
  let asked: ContextMenuItem[] = [];
  let written = '';
  const record = (_e: unknown, { data }: { id: string; data: string }) => (written += data);
  ipcMain.removeHandler(IPC.uiContextMenu);
  ipcMain.handle(IPC.uiContextMenu, (_e, items: ContextMenuItem[]) => {
    asked = items;
    return 'paste';
  });
  ipcMain.on(IPC.sessionWrite, record);
  const rightClick = async () => {
    written = '';
    const ok: boolean = await js(`(() => {
      const el = document.activeElement?.closest('.xterm');
      el?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
      return !!el;
    })()`);
    await wait(600);
    return ok;
  };
  try {
    await clipboard.writeText('AQMENU\x1b[201~TEXT');
    if (!(await rightClick())) return 'menu paste: the shell does not have focus';
    if (!asked.some((i) => i.id === 'paste')) return 'menu paste: the terminal menu has no Paste item';
    console.log(`[smoke] menu paste (text) wrote ${JSON.stringify(written)}`);
    if (!written.includes('AQMENU[201~TEXT') || written.includes('\x1b[201~T'))
      return `menu paste: text did not arrive through the safe paste (${JSON.stringify(written)})`;
    const png = new Blob([Buffer.from(TINY_PNG, 'base64')], { type: 'image/png' });
    await clipboard.write([new ClipboardItem({ 'image/png': png })]);
    await rightClick();
    console.log(`[smoke] menu paste (image) wrote ${JSON.stringify(written)}`);
    if (!/\.png ?/.test(written))
      return `menu paste: an image did not go in as a file path (${JSON.stringify(written)})`;
    press(win, 'U', ['control']); // clear the line we typed into
    await wait(200);
    return null;
  } finally {
    ipcMain.removeListener(IPC.sessionWrite, record);
    ipcMain.removeHandler(IPC.uiContextMenu);
    ipcMain.handle(IPC.uiContextMenu, (e, items: ContextMenuItem[]) =>
      showContextMenu(BrowserWindow.fromWebContents(e.sender), items),
    );
    clipboard.clear();
    if (saved.length) await clipboard.write(saved).catch(() => undefined);
  }
}

/** 1×1 transparent PNG. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * ⌘K → "Setup checklist": the first-run dialog opens with PATH, claude, codex, git, projects and login rows.
 * Saves a screenshot, then closes it with Esc (smoke never writes ~/.aquila/first-run.json). Returns an error or null.
 */
async function checkFirstRun(win: BrowserWindow, config: Config, out: string): Promise<string | null> {
  const label = translator(config.language)('firstRun.checklist');
  const clicked = await paletteRun(win, label);
  if (!clicked) return `palette has no "${label}" action`;
  const rows = async (): Promise<string[]> =>
    win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.c-dialog[open] .c-checklist__item')].map((el) => el.textContent)`,
    );
  let found: string[] = [];
  for (let i = 0; i < 40 && found.length < 6; i++) {
    await wait(250);
    found = await rows();
  }
  if (found.length < 6) {
    const dialogs: string = await win.webContents.executeJavaScript(
      `JSON.stringify([...document.querySelectorAll('dialog')].map((d) => [d.className, d.open, d.textContent.slice(0, 60)]))`,
    );
    return `first-run checklist shows ${found.length} rows, expected 6 (dialogs: ${dialogs})`;
  }
  await wait(400); // let the dialog finish rising in
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log(`[smoke] first-run checklist: ${JSON.stringify(found.slice(1, 4))}, screenshot: ${out}`);
  press(win, 'Escape', []);
  await wait(400);
  const stillOpen: boolean = await win.webContents.executeJavaScript(
    `!!document.querySelector('.c-dialog[open]')`,
  );
  return stillOpen ? 'Esc did not close the first-run checklist' : null;
}

/**
 * The real global key from another app (T41), opt-in with AQUILA_SMOKE_GLOBAL=1: needs Accessibility for the terminal
 * (System Events sends the key). Two new shells, the unfocused one reports waiting over OSC 7501; register ⌃⌥⌘J
 * through the app's own API (smoke never saves it), bring Finder to the front, press the key: the window must come
 * back focused on the waiting shell. The key is unregistered after.
 */
async function checkSummonFromOtherApp(win: BrowserWindow, s: SessionManager): Promise<string | null> {
  if (process.env.AQUILA_SMOKE_GLOBAL !== '1') {
    console.log(
      '[smoke] global shortcut from another app: skipped (AQUILA_SMOKE_GLOBAL=1, needs Accessibility)',
    );
    return null;
  }
  win.show();
  win.focus();
  const before = new Set(s.ids());
  press(win, 'T', ['meta', 'alt']);
  await wait(1500);
  press(win, 'T', ['meta', 'alt']);
  await wait(1500);
  const [waiting, other] = s.ids().filter((id) => !before.has(id));
  if (!waiting || !other) return 'global shortcut: could not open two shells';
  if (s.active !== other) return `global shortcut: expected the second shell focused, got ${s.active}`;
  s.write(waiting, SUMMON_WAITING);
  await wait(1500);
  const set = (acc: string | null): Promise<{ active: boolean; error?: string }> =>
    win.webContents.executeJavaScript(`window.aquila.setGlobalShortcut(${JSON.stringify(acc)})`);
  const reg = await set('Control+Alt+Command+J');
  if (!reg.active) return `global shortcut: ⌃⌥⌘J not registered (${reg.error ?? 'unknown'})`;
  try {
    execFileSync('open', ['-a', 'Finder']);
    await wait(1200);
    if (win.isFocused()) return 'global shortcut: Aquila still focused after opening Finder';
    try {
      // key code 38 = J
      execFileSync('osascript', [
        '-e',
        'tell application "System Events" to key code 38 using {control down, option down, command down}',
      ]);
    } catch (err) {
      return `global shortcut: System Events could not send the key (Accessibility?): ${(err as Error).message}`;
    }
    for (let i = 0; i < 20 && !(win.isFocused() && s.active === waiting); i++) await wait(100);
    if (!win.isFocused()) return 'global shortcut: the key did not bring the window to the front';
    if (s.active !== waiting)
      return `global shortcut: focused ${s.active}, expected the waiting shell ${waiting}`;
    console.log('[smoke] global shortcut from Finder: window up, focused the waiting shell');
    return null;
  } finally {
    await set(null);
  }
}

/**
 * ⌘K → "Global shortcut…" (T41) opens its dialog; a key pressed in the field is recorded (⌥⌘G), and one Aquila
 * uses in the window (⌘J) is refused. Screenshot, then Esc closes it — nothing is saved or registered.
 */
async function checkGlobalShortcut(win: BrowserWindow, config: Config, out: string): Promise<string | null> {
  const t = translator(config.language);
  const clicked = await paletteRun(win, t('globalShortcut.menu'));
  if (!clicked) return `palette has no "${t('globalShortcut.menu')}" action`;
  await wait(500);
  const field = `document.querySelector('.c-dialog[open] .c-input')`;
  const value = () => win.webContents.executeJavaScript(`${field}?.value ?? null`) as Promise<string | null>;
  await win.webContents.executeJavaScript(`${field}?.focus()`);
  press(win, 'J', ['meta']);
  await wait(200);
  const refused: boolean = await win.webContents.executeJavaScript(
    `!!document.querySelector('.c-dialog[open] .c-field__hint[data-tone=warning]')`,
  );
  if (!refused) return 'global shortcut accepted ⌘J, which Aquila uses in the window';
  press(win, 'G', ['meta', 'alt']);
  await wait(200);
  const recorded = await value();
  if (recorded !== '⌥⌘G') return `global shortcut recorded ${JSON.stringify(recorded)}, expected "⌥⌘G"`;
  await wait(300);
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log(`[smoke] global shortcut: refused ⌘J, recorded ${recorded}, screenshot: ${out}`);
  press(win, 'Escape', []);
  await wait(400);
  const stillOpen: boolean = await win.webContents.executeJavaScript(
    `!!document.querySelector('.c-dialog[open]')`,
  );
  return stillOpen ? 'Esc did not close the global shortcut dialog' : null;
}

/**
 * Note sources (T65): ⌘K → "Note sources…" opens the dialog; the three fixture folders (a meeting note, a frontmatter
 * spec, a memo) are added as sources (the folder picker is native, so through the bridge), the index worker reads
 * them, the rows say "1 notes", the shared ID is offered as a group, and the snapshot links the meeting note and the
 * spec through DB-12 with no link written. Sources and index live in the smoke's throwaway graph folder.
 */
async function checkGraphSources(win: BrowserWindow, config: Config, out: string): Promise<string | null> {
  const t = translator(config.language);
  if (!(await paletteRun(win, t('sources.menu')))) return `palette has no "${t('sources.menu')}" action`;
  await wait(500);
  const fixtures = path.join(__dirname, '..', '..', 'electron', 'fixtures', 'graph');
  for (const dir of ['meetings', 'specs', 'memos'])
    await win.webContents.executeJavaScript(
      `window.aquila.graphAddSource(${JSON.stringify(path.join(fixtures, dir))})`,
    );
  const rows = () =>
    win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.c-dialog[open] .c-checklist__item')].map((r) => r.textContent)`,
    ) as Promise<string[]>;
  const ready = t('sources.state.ready', { count: '1' });
  let seen: string[] = [];
  for (let i = 0; i < 50; i++) {
    seen = await rows();
    if (seen.length === 3 && seen.every((r) => r.includes(ready))) break;
    await wait(200);
  }
  if (seen.length !== 3 || !seen.every((r) => r.includes(ready)))
    return `note sources did not index: ${JSON.stringify(seen)}`;
  const offered: boolean = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.c-dialog[open] .c-meta__value')].some((v) => v.textContent.includes('DB-'))`,
  );
  if (!offered) return 'note sources: the shared DB- id is not offered as a group';
  const linked: boolean = await win.webContents.executeJavaScript(
    `window.aquila.graphSnapshot().then((g) => g.edges.some((e) => e.reasons.some((r) => r.via === 'id' && r.label === 'DB-12')))`,
  );
  if (!linked) return 'note sources: the snapshot has no DB-12 edge between the meeting note and the spec';
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log(
    `[smoke] note sources: 3 folders indexed in the worker, DB-12 links two notes, screenshot: ${out}`,
  );
  press(win, 'Escape', []);
  await wait(400);
  return null;
}

/**
 * Notes graph (T66 / T72), over the three sources `checkGraphSources` added. ⌘⇧N lazy-loads the panel on the focus
 * view ("Around"): the latest note in the middle, its links in columns. Search + Enter moves the centre to the
 * meeting note; clicking a column item moves there, Back returns. Then the Map: the WebGL canvas draws, the layout
 * worker settles within budget, a lens lights its answers. ⌘⇧N again removes the panel and its canvas.
 */
async function checkGraphView(win: BrowserWindow, config: Config, outDir: string): Promise<string | null> {
  const t = translator(config.language);
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  type Settled = { nodes: number; iterations: number; ms: number; via: string };
  const settled = async (via?: string, ms = 15_000) => {
    for (let i = 0; i < ms / 100; i++) {
      const s = await js<Settled | null>('window.__graphSettled ?? null');
      if (s && (!via || s.via === via || (via === 'layout' && s.via !== 'focus'))) return s;
      await wait(100);
    }
    return null;
  };
  const centerLabel = () =>
    js<string>(`document.querySelector('aside .c-kfocus__node[data-align=center] .c-kfocus__label')?.textContent ?? ''`);
  await js(`(() => { localStorage.removeItem('aquila.graph.mode'); window.__graphSettled = null; })()`);
  press(win, 'N', ['meta', 'shift']);
  const focus = await settled('focus');
  if (!focus) return 'graph: the focus view never showed after ⌘⇧N';
  const items = await js<number>(`document.querySelectorAll('aside .c-kfocus__node').length`);
  if (items < 2) return `graph: focus view shows ${items} node(s)`;
  if (await js<number>(`document.querySelectorAll('aside .c-kgraph canvas').length`))
    return 'graph: the focus view started a WebGL canvas';
  await wait(400); // the fade-in
  fs.writeFileSync(path.join(outDir, 'smoke-graph.png'), (await win.webContents.capturePage()).toPNG());

  // Search → Enter puts the meeting note in the middle (its file name is Korean in both languages).
  const meeting = '주간';
  const snap = await js<{ nodes: { id: string; kind: string; label: string }[] }>(
    'window.aquila.graphSnapshot()',
  );
  const notes = snap.nodes.filter((n) => n.kind === 'note');
  const target = notes.find((n) => n.label.includes(meeting)) ?? notes[0];
  if (!target) return 'graph: no notes in the snapshot';
  await js(`(() => {
    const input = document.querySelector('aside .c-panel__bar input[type=search]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    input.focus();
    set.call(input, ${JSON.stringify(target.label)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(300);
  const listed = await js<number>(`document.querySelectorAll('aside .c-kgraph__result').length`);
  if (!listed) return 'graph: search listed no results';
  press(win, 'Enter', []);
  await wait(500);
  if ((await centerLabel()) !== target.label)
    return `graph: search + Enter centred "${await centerLabel()}", wanted "${target.label}"`;

  // Click an item in a column → it becomes the centre; Back → the meeting note again.
  const next = await js<string | null>(`(() => {
    const b = document.querySelector('aside .c-kfocus__node:not([data-align=center])');
    if (!b) return null;
    const label = b.querySelector('.c-kfocus__label')?.textContent ?? '';
    b.click();
    return label;
  })()`);
  if (!next) return `graph: "${target.label}" has nothing around it`;
  await wait(500);
  const moved = await centerLabel();
  await js(`document.querySelector('aside .c-kgraph__trail button')?.click()`);
  await wait(500);
  const backTo = await centerLabel();
  if (backTo !== target.label) return `graph: Back went to "${backTo}", wanted "${target.label}"`;

  // The Map: WebGL graph + layout worker, then a lens.
  await js('window.__graphSettled = null');
  const toMap = await js<boolean>(`(() => {
    const b = [...document.querySelectorAll('aside .c-segment__item')].find((e) => e.textContent.trim() === ${JSON.stringify(t('graph.mode.map'))});
    b?.click();
    return !!b;
  })()`);
  if (!toMap) return 'graph: no Map switch';
  const whole = await settled('layout');
  if (!whole) return 'graph: the map layout never settled';
  if (!(await js<number>(`document.querySelectorAll('aside .c-kgraph canvas').length`)))
    return 'graph: no canvas on the map';
  if (whole.ms > 3500) return `graph: layout ran ${whole.ms} ms (budget 3 s)`;
  if (focus.nodes > whole.nodes) return `graph: focus view has ${focus.nodes} nodes, the map ${whole.nodes}`;
  // A lens with answers switches on; one with none can't be pressed.
  const lensState = await js<{ chips: number; on: boolean | null }>(`(async () => {
    const chips = [...document.querySelectorAll('aside .c-kgraph__lens')];
    const b = chips.find((c) => !c.disabled);
    if (!b) return { chips: chips.length, on: null };
    b.click();
    await new Promise((r) => setTimeout(r, 300));
    return { chips: chips.length, on: b.getAttribute('aria-pressed') === 'true' };
  })()`);
  if (lensState.chips !== 4) return `graph: ${lensState.chips} lens chips on the map, expected 4`;
  if (lensState.on === false) return 'graph: a lens did not switch on';
  fs.writeFileSync(path.join(outDir, 'smoke-graph-map.png'), (await win.webContents.capturePage()).toPNG());
  await js(`localStorage.removeItem('aquila.graph.mode')`);
  press(win, 'N', ['meta', 'shift']);
  await wait(400);
  const left = await js<number>(`document.querySelectorAll('.c-kgraph').length`);
  if (left) return 'graph: ⌘⇧N did not close the panel';
  console.log(
    `[smoke] graph: focus ${focus.nodes} nodes in ${focus.ms} ms; "${target.label}" → "${moved}" → back; map ${whole.nodes} nodes settled in ${whole.ms} ms (${whole.iterations} iterations)`,
  );
  return null;
}

/**
 * Note editor (T67), on a copy of the CRLF fixture in a throwaway source: ⌘O finds it and lazy-loads the editor;
 * live preview draws the table and checkboxes. A checkbox click, a table cell + Tab + typed text and Korean typed
 * through the IME (with an Enter mid-composition) each save exactly that change — every other byte, CRLFs
 * included, stays. Then an outside write under an unsaved edit shows the banner; Compare shows a diff and Reload
 * takes the disk version (nothing of ours is written).
 */
async function checkNoteEditor(win: BrowserWindow, config: Config, outDir: string): Promise<string | null> {
  const t = translator(config.language);
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const until = async (code: string, ms = 5000) => {
    for (let i = 0; i < ms / 100; i++) {
      if (await js<boolean>(code)) return true;
      await wait(100);
    }
    return false;
  };
  const fileUntil = async (want: string, ms = 4000) => {
    for (let i = 0; i < ms / 100; i++) {
      if (fs.readFileSync(file, 'utf8') === want) return true;
      await wait(100);
    }
    return false;
  };
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'aquila-smoke-notes-'));
  const file = path.join(dir, 'crlf-table.md');
  fs.copyFileSync(path.join(__dirname, '..', '..', 'electron', 'fixtures', 'notes', 'crlf-table.md'), file);
  // A pasted-style image next to the note: live preview shows it through aquila-note://.
  fs.mkdirSync(path.join(dir, 'attachments'));
  fs.writeFileSync(
    path.join(dir, 'attachments', 'dot.png'),
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  fs.appendFileSync(file, '![dot](attachments/dot.png)\r\n');
  const original = fs.readFileSync(file, 'utf8');
  const dbg = win.webContents.debugger;
  try {
    await js(`window.aquila.graphAddSource(${JSON.stringify(dir)})`);
    if (
      !(await until(
        `window.aquila.graphSnapshot().then((g) => g.nodes.some((n) => n.path === ${JSON.stringify(file)}))`,
        10_000,
      ))
    )
      return 'note editor: the copied note never reached the index';

    // ⌘O → the note's title → Enter.
    press(win, 'O', ['meta']);
    if (!(await until(`!!document.querySelector('.c-palette[open]')`)))
      return 'note editor: ⌘O opened no palette';
    await js(`(() => {
      const input = document.querySelector('.c-palette[open] input');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, '릴리스 체크');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await wait(200);
    press(win, 'Enter', []);
    if (
      !(await until(
        `!!document.querySelector('.c-editor .cm-md-table td') && document.querySelectorAll('.c-editor .cm-md-checkbox').length === 2`,
        8000,
      ))
    )
      return 'note editor: no live preview (rendered table + two checkboxes) after ⌘O';
    if (
      !(await until(
        `(() => { const i = document.querySelector('.c-editor img.cm-md-img'); return !!i && i.complete && i.naturalWidth > 0; })()`,
      ))
    )
      return 'note editor: the image next to the note did not load inline';

    // 1. A checkbox: one character changes.
    await js(`(() => {
      const b = [...document.querySelectorAll('.c-editor .cm-md-checkbox')].find((x) => !x.checked);
      b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    })()`);
    let want = original.replace('- [ ] 빌드 확인', '- [x] 빌드 확인');
    if (!(await fileUntil(want)))
      return 'note editor: the checkbox click did not save as exactly one changed character';

    // 2. A table cell, Tab, typing: the raw rows show while the cursor is in the table.
    await js(`(() => {
      const td = [...document.querySelectorAll('.c-editor .cm-md-table td')].find((x) => x.textContent === 'editor');
      td.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    })()`);
    if (!(await until(`!document.querySelector('.c-editor .cm-md-table')`)))
      return 'note editor: the table stayed rendered with the cursor in it';
    press(win, 'Tab', []);
    await wait(100);
    win.webContents.insertText('X');
    await wait(100);

    // 3. Korean through the IME, with an Enter that belongs to the composition (must not add a table row).
    if (!dbg.isAttached()) dbg.attach('1.3');
    const cdp = (method: string, params: object = {}) => dbg.sendCommand(method, params);
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    for (const text of ['ㅎ', '하', '한'])
      await cdp('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
    for (const type of ['rawKeyDown', 'keyUp'])
      await cdp('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 229,
        nativeVirtualKeyCode: 229,
      });
    await cdp('Input.insertText', { text: '한' });
    await wait(100);
    press(win, 'S', ['meta']);
    want = want.replace('| editor | 서연 |', '| editor | X한서연 |');
    if (!(await fileUntil(want)))
      return `note editor: table + IME edit saved wrong: ${JSON.stringify(fs.readFileSync(file, 'utf8'))}`;

    // 4. An outside write under an unsaved edit: banner, compare, reload.
    win.webContents.insertText('Z');
    const external = `${want}outside line\r\n`;
    fs.writeFileSync(file, external);
    if (
      !(await until(
        `[...document.querySelectorAll('.c-editor__banner')].some((b) => b.textContent.includes(${JSON.stringify(t('note.changed'))}))`,
      ))
    )
      return 'note editor: no banner after an outside write under an unsaved edit';
    const button = (label: string) =>
      js<boolean>(`(() => {
        const b = [...document.querySelectorAll('.c-editor__banner button')].find((x) => x.textContent.trim() === ${JSON.stringify(label)});
        b?.click();
        return !!b;
      })()`);
    if (!(await button(t('note.compare')))) return 'note editor: the banner has no Compare';
    if (!(await until(`!!document.querySelector('.c-editor__compare .c-diff__line--add')`)))
      return 'note editor: Compare shows no diff';
    fs.writeFileSync(path.join(outDir, 'smoke-note.png'), (await win.webContents.capturePage()).toPNG());
    if (!(await button(t('note.reload')))) return 'note editor: the banner has no Reload';
    if (
      !(await until(
        `!document.querySelector('.c-editor__banner') && document.querySelector('.c-editor .cm-content').textContent.includes('outside line')`,
      ))
    )
      return 'note editor: Reload did not load the disk version';
    await wait(1500);
    if (fs.readFileSync(file, 'utf8') !== external)
      return 'note editor: Reload still wrote our edit to the file';

    await js(
      `document.querySelector('aside[aria-label=${JSON.stringify(t('note.title'))}] .c-panel__actions button:last-child').click()`,
    );
    if (!(await until(`!document.querySelector('.c-editor')`)))
      return 'note editor: close left the editor open';
    console.log(
      '[smoke] note editor: ⌘O, live preview, checkbox / table / IME saves byte-exact (CRLF kept), outside-write banner + compare + reload',
    );
    return null;
  } finally {
    const status = await js<{ sources: { id: string; path: string }[] }>('window.aquila.graphStatus()');
    const src = status.sources.find((x) => x.path.endsWith(path.basename(dir)));
    if (src) await js(`window.aquila.graphRemoveSource(${JSON.stringify(src.id)})`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Link suggestions (T68), on a copy of the `links` fixtures in a throwaway source: the meeting note gets a dotted
 * (similar words) suggestion to the spec with no link written; in the graph card, "[[" accepts it and writes
 * `[[printable-reports]]` as the note's last line (nothing else changes). Three accepts of DB- links propose a rule
 * in the card; "Make a rule" adds it. ⌘K → "Link suggestions…": the rule is listed; AI on + Run now (a canned
 * Claude reply) adds a suggested person node.
 */
async function checkLinkSuggestions(
  win: BrowserWindow,
  config: Config,
  outDir: string,
): Promise<string | null> {
  const t = translator(config.language);
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const until = async (code: string, ms = 8000) => {
    for (let i = 0; i < ms / 100; i++) {
      if (await js<boolean>(code)) return true;
      await wait(100);
    }
    return false;
  };
  const fixtures = path.join(__dirname, '..', '..', 'electron', 'fixtures', 'links');
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'aquila-smoke-links-'));
  for (const sub of ['meetings', 'specs', 'bugs', 'memos']) {
    fs.mkdirSync(path.join(dir, sub));
    for (const f of fs.readdirSync(path.join(fixtures, sub)))
      fs.copyFileSync(path.join(fixtures, sub, f), path.join(dir, sub, f));
  }
  const meetingFile = path.join(dir, 'meetings', '2026-11-18 planning.md');
  const before = fs.readFileSync(meetingFile, 'utf8');
  let sourceId = '';
  try {
    const st = await js<{ sources: { id: string; path: string }[] }>(
      `window.aquila.graphAddSource(${JSON.stringify(dir)})`,
    );
    sourceId = st.sources.find((x) => x.path.endsWith(path.basename(dir)))?.id ?? '';
    if (!sourceId) return 'links: the fixture source was not added';
    const id = (rel: string) => JSON.stringify(`note:${sourceId}:${rel}`);
    const meeting = id('meetings/2026-11-18 planning.md');
    const spec = id('specs/printable-reports.md');
    const edgeOf = (a: string, b: string) =>
      `window.aquila.graphSnapshot().then((g) => g.edges.find((e) => (e.source === ${a} && e.target === ${b}) || (e.source === ${b} && e.target === ${a})) ?? null)`;
    if (
      !(await until(
        `${edgeOf(meeting, spec)}.then((e) => e?.kind === 'suggested' && e.reasons[0].via === 'similar')`,
      ))
    )
      return 'links: no suggested (similar) edge between the meeting note and the spec';

    // Graph foot card: centre the meeting note, open "Suggested links": the spec is listed with a dotted line;
    // "[[" accepts and writes the link.
    press(win, 'N', ['meta', 'shift']);
    if (!(await until(`!!document.querySelector('aside .c-kgraph')`))) return 'links: graph panel did not open';
    await js(`(() => {
      const input = document.querySelector('aside .c-panel__bar input[type=search]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      input.focus();
      set.call(input, '2026-11-18 Planning');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await wait(300);
    press(win, 'Enter', []);
    if (!(await until(`document.querySelector('aside .c-kgraph__foot-title')?.textContent === '2026-11-18 Planning'`)))
      return 'links: search + Enter did not centre the meeting note';
    await js(`document.querySelector('aside .c-kgraph__foot button[aria-expanded=false]')?.click()`);
    const row = `[...document.querySelectorAll('.c-kgraph__foot .c-suggest__item')].find((r) => r.textContent.includes('Printable reports'))`;
    if (!(await until(`!!${row}?.querySelector('.c-suggest__line[data-line=dotted]')`)))
      return 'links: the foot card does not list the spec as a dotted suggestion';
    await wait(500);
    fs.writeFileSync(
      path.join(outDir, 'smoke-links-card.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(`${row}.querySelector('button[aria-label=${JSON.stringify(t('links.insert'))}]').click()`);
    const want = `${before}[[printable-reports]]\n`;
    for (let i = 0; i < 40 && fs.readFileSync(meetingFile, 'utf8') !== want; i++) await wait(100);
    if (fs.readFileSync(meetingFile, 'utf8') !== want)
      return `links: "[[" did not write exactly one [[link]] line: ${JSON.stringify(fs.readFileSync(meetingFile, 'utf8').slice(-80))}`;
    if (!(await until(`${edgeOf(meeting, spec)}.then((e) => e?.kind === 'explicit')`)))
      return 'links: the accepted suggestion did not turn solid';

    // Three accepts of DB- links → a rule proposal in the card → "Make a rule".
    for (const [a, b] of [
      [meeting, id('bugs/import-crash.md')],
      [id('bugs/slow-search.md'), id('memos/search-memo.md')],
      [id('bugs/login-loop.md'), id('memos/auth-memo.md')],
    ])
      await js(`window.aquila.graphDecide({ source: ${a}, target: ${b}, accept: true })`);
    const proposal = `[...document.querySelectorAll('.c-kgraph__foot .c-suggest__proposal')].find((r) => r.textContent.includes('DB-<n>'))`;
    if (!(await until(`!!${proposal}`))) return 'links: three DB- accepts did not propose a rule';
    await js(
      `[...${proposal}.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(t('links.makeRule'))}).click()`,
    );
    if (!(await until(`window.aquila.graphStatus().then((s) => s.links?.rules.length === 1)`)))
      return 'links: "Make a rule" did not add the rule';
    press(win, 'N', ['meta', 'shift']);
    await wait(400);

    // ⌘K → Link suggestions…: the rule is listed; AI on + Run now → a suggested person from the canned reply.
    if (!(await paletteRun(win, t('links.menu')))) return `palette has no "${t('links.menu')}" action`;
    const item = `[...document.querySelectorAll('.c-dialog[open] .c-checklist__item')].find((r) => r.textContent.includes(${JSON.stringify(path.basename(dir))}))`;
    if (!(await until(`!!${item}`))) return 'links: the dialog does not list the source';
    const ruled = await js<boolean>(
      `[...document.querySelectorAll('.c-dialog[open] .c-checklist__item')].some((r) => r.textContent.includes('DB-<n>'))`,
    );
    if (!ruled) return 'links: the dialog does not list the DB-<n> rule';
    const click = (label: string) =>
      js<boolean>(`(() => {
        const b = [...(${item})?.querySelectorAll('button') ?? []].find((x) => x.textContent === ${JSON.stringify(label)} && !x.disabled);
        b?.click();
        return !!b;
      })()`);
    if (!(await click(t('links.aiOn')))) return 'links: no "Turn AI on" for the source';
    if (
      !(await until(
        `(() => { const b = [...(${item})?.querySelectorAll('button') ?? []].find((x) => x.textContent === ${JSON.stringify(t('links.runNow'))}); return !!b && !b.disabled; })()`,
      ))
    )
      return 'links: "Run now" never became available';
    await click(t('links.runNow'));
    if (
      !(await until(
        `window.aquila.graphSnapshot().then((g) => g.nodes.some((n) => n.id === 'person:mina' && n.kind === 'person'))`,
      ))
    )
      return 'links: AI extraction (canned reply) added no person node';
    await wait(300);
    fs.writeFileSync(path.join(outDir, 'smoke-links.png'), (await win.webContents.capturePage()).toPNG());
    press(win, 'Escape', []);
    await wait(400);
    console.log(
      '[smoke] links: similar-words suggestion meeting → spec, "[[" wrote one line, 3 DB- accepts → rule, AI (canned) → person node',
    );
    return null;
  } finally {
    if (sourceId) await js(`window.aquila.graphRemoveSource(${JSON.stringify(sourceId)})`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Per-source settings (T69), on a copy of the `vault/requirements` fixture (a data-bahn-like requirements folder
 * whose shared `.aquila-vault.json` is fixture data, nothing built in): its link rule links DB-7100 → DB-6891;
 * ⌘K → "Folder settings…" shows the config; "Board" opens three status columns; Alt+→ on a card moves its file to
 * the next folder; a card opens the spec with its checklist / retrospect as tabs; "Changelog" adds exactly the dated
 * line and `revised:` (saved like typing); a tab opens the checklist; "Make with Claude" (canned reply) fills the draft.
 */
async function checkVault(win: BrowserWindow, config: Config, outDir: string): Promise<string | null> {
  const t = translator(config.language);
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const until = async (code: string, ms = 8000) => {
    for (let i = 0; i < ms / 100; i++) {
      if (await js<boolean>(code)) return true;
      await wait(100);
    }
    return false;
  };
  const dir = path.join(
    fs.mkdtempSync(path.join(app.getPath('temp'), 'aquila-smoke-vault-')),
    'requirements',
  );
  fs.cpSync(path.join(__dirname, '..', '..', 'electron', 'fixtures', 'vault', 'requirements'), dir, {
    recursive: true,
  });
  const spec = path.join(dir, 'specs', 'done', 'DB-6891-downloads.md');
  const specBefore = fs.readFileSync(spec, 'utf8');
  let sourceId = '';
  try {
    const st = await js<{ sources: { id: string; path: string }[] }>(
      `window.aquila.graphAddSource(${JSON.stringify(dir)})`,
    );
    sourceId =
      st.sources.find((x) => x.path.endsWith(`${path.basename(path.dirname(dir))}/requirements`))?.id ?? '';
    if (!sourceId) return 'vault: the fixture source was not added';
    const id = (rel: string) => JSON.stringify(`note:${sourceId}:${rel}`);
    if (
      !(await until(
        `window.aquila.graphSnapshot().then((g) => g.edges.some((e) => e.source === ${id('specs/to-do/DB-7100-search.md')} && e.target === ${id('specs/done/DB-6891-downloads.md')} && e.reasons.some((r) => r.via === 'rule')))`,
        10_000,
      ))
    )
      return 'vault: the shared link rule did not link DB-7100 → DB-6891';

    // ⌘K → Folder settings…: select the source; the preview lists the board, companions and the Changelog action.
    if (!(await paletteRun(win, t('vault.menu')))) return `palette has no "${t('vault.menu')}" action`;
    const item = `document.getElementById(${JSON.stringify(`vault-source-${sourceId}`)})`;
    if (!(await until(`!!${item}`))) return 'vault: the settings do not list the source';
    await js(`${item}.click()`);
    if (
      !(await until(
        `(() => { const b = document.querySelector('.c-modal[open] .c-modal__bullets')?.textContent ?? ''; return b.includes('Board') && b.includes('Changelog') && b.includes('checklists'); })()`,
      ))
    )
      return 'vault: the settings preview does not show the board, companions and Changelog';
    await wait(300);
    fs.writeFileSync(
      path.join(outDir, 'smoke-vault-settings.png'),
      (await win.webContents.capturePage()).toPNG(),
    );

    // Open the board: three status columns from the folders.
    await js(
      `[...document.querySelectorAll('.c-modal[open] button')].find((b) => b.textContent === 'Board').click()`,
    );
    if (
      !(await until(
        `[...document.querySelectorAll('.c-modal[open] .c-board__head')].map((h) => h.firstChild.textContent).join() === 'to-do,in-progress,done'`,
      ))
    )
      return 'vault: the board does not show to-do / in-progress / done';
    await wait(300);
    fs.writeFileSync(
      path.join(outDir, 'smoke-vault-board.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    // Alt+→ on the to-do card moves its file into in-progress.
    await js(`(() => {
      const card = [...document.querySelectorAll('.c-modal[open] .c-board__card')].find((c) => c.textContent.includes('DB-7100'));
      card.focus();
      card.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    })()`);
    const movedTo = path.join(dir, 'specs', 'in-progress', 'DB-7100-search.md');
    for (let i = 0; i < 40 && !fs.existsSync(movedTo); i++) await wait(100);
    if (!fs.existsSync(movedTo) || fs.existsSync(path.join(dir, 'specs', 'to-do', 'DB-7100-search.md')))
      return 'vault: moving a card did not move its file to in-progress';

    // A card opens the spec in the editor, with its companions as tabs and the Changelog action.
    await js(
      `[...document.querySelectorAll('.c-modal[open] .c-board__card')].find((c) => c.textContent.includes('DB-6891')).click()`,
    );
    if (
      !(await until(
        `[...document.querySelectorAll('.c-editor__tab')].map((b) => b.textContent).join() === 'specs,checklists,retrospects'`,
        10_000,
      ))
    )
      return 'vault: the spec does not show specs / checklists / retrospects tabs';
    const changelog = `[...document.querySelectorAll('.c-editor__tabs-end button')].find((b) => b.textContent === 'Changelog')`;
    if (!(await until(`!!${changelog} && !${changelog}.disabled`)))
      return 'vault: no Changelog action on the spec';
    await wait(300);
    fs.writeFileSync(
      path.join(outDir, 'smoke-vault-note.png'),
      (await win.webContents.capturePage()).toPNG(),
    );
    await js(`${changelog}.click()`);
    const date = isoDate(new Date());
    const want = applyAction(
      specBefore,
      {
        id: 'changelog',
        name: 'Changelog',
        kind: 'insert',
        under: 'Changelog',
        block: '- **{{date}}**: \n  - 사유: \n  - 영향: ',
        set: { revised: '{{date}}' },
      },
      { date },
    );
    for (let i = 0; i < 50 && fs.readFileSync(spec, 'utf8') !== want; i++) await wait(100);
    if (fs.readFileSync(spec, 'utf8') !== want)
      return `vault: Changelog did not save exactly the dated line and revised: ${JSON.stringify(fs.readFileSync(spec, 'utf8').slice(-160))}`;

    // A tab opens the checklist.
    await js(
      `[...document.querySelectorAll('.c-editor__tab')].find((b) => b.textContent === 'checklists').click()`,
    );
    if (
      !(await until(
        `document.querySelector('.c-editor__tab[aria-selected=true]')?.textContent === 'checklists'`,
      ))
    )
      return 'vault: the checklists tab did not open the checklist';

    // Make with Claude (canned reply) fills the draft; nothing is saved.
    if (!(await paletteRun(win, t('vault.menu')))) return `palette has no "${t('vault.menu')}" action`;
    if (!(await until(`!!${item}`))) return 'vault: the settings do not list the source (again)';
    await js(`${item}.click()`);
    await wait(300);
    const shared = fs.readFileSync(path.join(dir, '.aquila-vault.json'), 'utf8');
    await js(
      `[...document.querySelectorAll('.c-modal[open] button')].find((b) => b.textContent === ${JSON.stringify(t('vault.claudeMake'))}).click()`,
    );
    if (
      !(await until(
        `(document.querySelector('.c-modal[open] textarea.c-input--code')?.value ?? '').includes('"verify"') === false && (document.querySelector('.c-modal[open] .c-modal__bullets')?.textContent ?? '').includes('Board')`,
      ))
    )
      return 'vault: "Make with Claude" did not fill the draft';
    if (fs.readFileSync(path.join(dir, '.aquila-vault.json'), 'utf8') !== shared)
      return 'vault: the draft was written before Save';
    press(win, 'Escape', []);
    await wait(300);
    // Close the editor.
    await js(
      `document.querySelector('aside .c-panel__actions button[aria-label=${JSON.stringify(t('action.close'))}]')?.click()`,
    );
    await wait(300);
    console.log(
      '[smoke] vault: shared link rule, settings preview, board (3 columns, Alt+→ moved the file), companion tabs, Changelog saved exactly, Make with Claude (canned)',
    );
    return null;
  } finally {
    if (sourceId) await js(`window.aquila.graphRemoveSource(${JSON.stringify(sourceId)})`);
    fs.rmSync(path.dirname(dir), { recursive: true, force: true });
  }
}

/**
 * The app in the graph (T70): a note in a throwaway source, and a Claude transcript (written into the smoke's graph
 * folder, read like history) that got the note as `@"path"` and edited a file. The snapshot has the solid path
 * note → session → changed file; in the graph the session's card offers Resume, the note's "Handle with Claude".
 */
async function checkAppGraph(win: BrowserWindow, config: Config, outDir: string): Promise<string | null> {
  const t = translator(config.language);
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const until = async (code: string, ms = 8000) => {
    for (let i = 0; i < ms / 100; i++) {
      if (await js<boolean>(code)) return true;
      await wait(100);
    }
    return false;
  };
  const select = async (label: string) => {
    await js(`(() => {
      const input = document.querySelector('aside .c-panel__bar input[type=search]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      input.focus();
      set.call(input, ${JSON.stringify(label)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await wait(300);
    press(win, 'Enter', []);
    return until(
      `document.querySelector('aside .c-kgraph__foot-title')?.textContent === ${JSON.stringify(label)}`,
      3000,
    );
  };
  const cardHas = (text: string) =>
    until(
      `[...document.querySelectorAll('aside .c-kgraph__foot button')].some((b) => b.textContent.trim() === ${JSON.stringify(text)})`,
      3000,
    );
  const root = fs.mkdtempSync(path.join(app.getPath('temp'), 'aquila-smoke-app-'));
  const notes = path.join(root, 'notes');
  fs.mkdirSync(notes);
  const note = path.join(notes, 'login plan.md');
  fs.writeFileSync(note, '# Login plan\n\nValidate the form before sending.\n');
  const repo = path.join(root, 'repo');
  const changed = path.join(repo, 'src', 'LoginForm.tsx');
  const transcripts = path.join(app.getPath('temp'), `aquila-smoke-graph-${process.pid}`, 'transcripts');
  const transcript = path.join(transcripts, 'smoke-t70.jsonl');
  const intro = t('note.handle.note');
  let sourceId = '';
  try {
    const st = await js<{ sources: { id: string; path: string }[] }>(
      `window.aquila.graphAddSource(${JSON.stringify(notes)})`,
    );
    sourceId = st.sources.find((x) => x.path.endsWith(`${path.basename(root)}/notes`))?.id ?? '';
    if (!sourceId) return 'app graph: the note source was not added';
    const noteId = JSON.stringify(`note:${sourceId}:login plan.md`);
    if (
      !(await until(
        `window.aquila.graphSnapshot().then((g) => g.nodes.some((n) => n.id === ${noteId}))`,
        10_000,
      ))
    )
      return 'app graph: the note was not indexed';
    const at = new Date().toISOString();
    const line = (type: string, content: unknown) =>
      JSON.stringify({ type, cwd: repo, timestamp: at, message: { content } });
    fs.mkdirSync(transcripts, { recursive: true });
    fs.writeFileSync(
      transcript,
      [
        line('user', `${intro}\n\n@"${note}"`),
        line('assistant', [
          { type: 'text', text: 'Done.' },
          { type: 'tool_use', id: 'e1', name: 'Edit', input: { file_path: changed } },
        ]),
      ].join('\n'),
    );
    const sid = JSON.stringify('session:claude:smoke-t70');
    const fid = JSON.stringify(`file:${changed}`);
    const path3 = `window.aquila.graphSnapshot().then((g) => [[${noteId}, ${sid}], [${sid}, ${fid}]].every(([a, b]) => g.edges.some((e) => e.source === a && e.target === b && e.kind === 'action' && e.strength === 1)))`;
    if (!(await until(path3)))
      return 'app graph: no solid note → session → changed file path in the snapshot';
    if ((await js<string | null>(`window.aquila.noteProject(${JSON.stringify(note)})`)) !== null)
      return 'app graph: a note outside every project got a project';

    await js('window.__graphSettled = null');
    press(win, 'N', ['meta', 'shift']);
    if (!(await until('!!window.__graphSettled', 15_000))) return 'app graph: the graph never settled';
    if (!(await select(intro))) return 'app graph: the session node could not be selected';
    if (!(await cardHas(t('graph.resume')))) return 'app graph: the session card has no Resume';
    fs.writeFileSync(path.join(outDir, 'smoke-app-graph.png'), (await win.webContents.capturePage()).toPNG());
    if (!(await select('Login plan'))) return 'app graph: the note could not be selected';
    if (!(await cardHas(t('note.handle')))) return `app graph: the note card has no "${t('note.handle')}"`;
    // Daily note: the source gets the Daily journal preset, so the button (no source picked) goes to its
    // `journal/<date>.md` and adds today's sessions under the heading; a second click adds nothing.
    await js(
      `window.aquila.vaultPreset('daily').then((c) => window.aquila.vaultSave(${JSON.stringify(sourceId)}, c, 'personal'))`,
    );
    const clickDaily = () =>
      js(
        `[...document.querySelectorAll('aside .c-panel__head button')].find((b) => b.textContent.trim() === ${JSON.stringify(t('graph.daily'))})?.click()`,
      );
    const journal = path.join(notes, 'journal');
    const daily = () => (fs.existsSync(journal) ? fs.readdirSync(journal)[0] : undefined);
    await clickDaily();
    for (let i = 0; i < 80 && !daily(); i++) await wait(100);
    const dailyName = daily();
    if (!dailyName) {
      const btn = await js<string[]>(
        `[...document.querySelectorAll('aside .c-panel__head button')].map((b) => b.textContent.trim())`,
      );
      return `app graph: no journal note was made (head buttons: ${JSON.stringify(btn)}, files: ${JSON.stringify(fs.readdirSync(notes))})`;
    }
    const dailyFile = path.join(journal, dailyName);
    const heading = config.language === 'ko' ? '## 세션' : '## Sessions';
    await wait(500);
    const once = fs.readFileSync(dailyFile, 'utf8');
    if (!once.includes(heading))
      return `app graph: the daily note has no "${heading}": ${JSON.stringify(once.slice(0, 200))}`;
    await clickDaily();
    await wait(800);
    if (fs.readFileSync(dailyFile, 'utf8') !== once)
      return 'app graph: a second click changed the daily note';
    const listed = once.split('\n').filter((l) => l.startsWith('- ')).length;
    press(win, 'N', ['meta', 'shift']);
    await wait(300);
    await js(
      `document.querySelector('aside .c-panel__actions button[aria-label=${JSON.stringify(t('action.close'))}]')?.click()`,
    );
    await wait(300);
    console.log(
      `[smoke] app graph: note → session → changed file (solid), Resume on the session, Handle with Claude on the note, daily note "${dailyName}" (${listed} sessions today, second click unchanged)`,
    );
    return null;
  } finally {
    fs.rmSync(transcript, { force: true });
    if (sourceId) await js(`window.aquila.graphRemoveSource(${JSON.stringify(sourceId)})`);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** ⌘K → "Project settings…" opens the settings dialog with its fields; screenshot, then Esc closes it (nothing saved). */
async function checkProjectSettings(win: BrowserWindow, config: Config, out: string): Promise<string | null> {
  const label = translator(config.language)('settings.action');
  const clicked = await paletteRun(win, label);
  if (!clicked) return `palette has no "${label}" action`;
  let fields = 0;
  for (let i = 0; i < 20 && fields < 9; i++) {
    await wait(150);
    fields = await win.webContents.executeJavaScript(
      `document.querySelectorAll('.c-dialog[open] .c-field').length`,
    );
  }
  if (fields < 9) return `project settings shows ${fields} fields, expected 9`;
  await wait(400); // let the dialog finish rising in
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  console.log(`[smoke] project settings: ${fields} fields, screenshot: ${out}`);
  // Figma MCP (T32): switching it on shows the check + docs buttons (screenshot only; Esc discards it).
  const figmaOn = translator(config.language)('figma.on');
  const figmaShown: boolean = await win.webContents.executeJavaScript(`(() => {
    const segs = [...document.querySelectorAll('.c-dialog[open] .c-segment')];
    const on = [...(segs.at(-1)?.querySelectorAll('button, [role=radio]') ?? [])].find((el) => el.textContent === ${JSON.stringify(figmaOn)});
    on?.click();
    return !!on;
  })()`);
  if (figmaShown) {
    await wait(300);
    await win.webContents.executeJavaScript(
      `document.querySelector('.c-dialog[open] .c-dialog__body')?.scrollTo(0, 1e6)`,
    );
    await wait(200);
    const figmaOut = out.replace(/\.png$/, '-figma.png');
    fs.writeFileSync(figmaOut, (await win.webContents.capturePage()).toPNG());
    console.log(`[smoke] figma settings: screenshot: ${figmaOut}`);
  }
  press(win, 'Escape', []);
  await wait(400);
  const stillOpen: boolean = await win.webContents.executeJavaScript(
    `!!document.querySelector('.c-dialog[open]')`,
  );
  return stillOpen ? 'Esc did not close project settings' : null;
}

/**
 * T35: nothing is fetched until AI trends is clicked; opening the modal fetches the (fixture) feeds — Claude 2.1.327 installed
 * → 2.1.329 and 2.1.328 newer. Checks the CLI rows and their "Added" lines, the Industry tab, and (T46) that AI trends
 * sits in the footer, gets its update dot after that fetch, and that "+ Add project" is a row under the list.
 */
async function checkTrends(win: BrowserWindow, outDir: string): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  // Footer order: ⚙ Settings, AI trends, ? — AI trends is the first icon button.
  const button = `document.querySelector('.c-sidebar__foot .c-btn--icon')`;
  if (!(await js<boolean>(`!!${button}?.querySelector('svg')`)))
    return 'trends: no AI trends button in the sidebar footer';
  if (!(await js<boolean>(`!!document.querySelector('.c-sidebar__body > .c-sidebar__add')`)))
    return 'sidebar: no "+ Add project" row under the project list';
  await js(`${button}.click()`);
  await wait(300);
  await js(`document.querySelectorAll('.c-modal[open] .c-segment__item')[0]?.click()`);
  let rows: string[] = [];
  for (let i = 0; i < 40 && !rows.some((r) => r.startsWith('2.1.329')); i++) {
    await wait(250);
    rows = await js<string[]>(
      `[...document.querySelectorAll('.c-modal[open] .c-modal__item')].map((el) => el.textContent.trim())`,
    );
  }
  if (!rows.some((r) => r.startsWith('2.1.329')) || !rows.some((r) => r.startsWith('2.1.328')))
    return `trends: CLI tab rows ${JSON.stringify(rows)}, expected 2.1.329 and 2.1.328 after opening fetched`;
  await js(
    `[...document.querySelectorAll('.c-modal[open] .c-modal__item')].find((el) => el.textContent.trim().startsWith('2.1.329'))?.click()`,
  );
  await wait(200);
  const bullets = await js<number>(`document.querySelectorAll('.c-modal[open] .c-modal__bullets li').length`);
  if (bullets < 3) return `trends: selected release shows ${bullets} "Added" lines, expected 3–5`;
  if (!(await js<boolean>(`!!${button}.querySelector('.c-btn__badge')`)))
    return 'trends: no update dot on AI trends after the fetch found a newer Claude';
  await wait(300);
  fs.writeFileSync(path.join(outDir, 'smoke-trends.png'), (await win.webContents.capturePage()).toPNG());
  await js(`document.querySelectorAll('.c-modal[open] .c-segment__item')[1]?.click()`);
  await wait(300);
  const industry = await js<string>(
    `document.querySelector('.c-modal[open] .c-modal__heading')?.textContent ?? ''`,
  );
  if (!industry) return 'trends: Industry tab shows no detail';
  fs.writeFileSync(
    path.join(outDir, 'smoke-trends-industry.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  // T63: the Industry tab's Global / Korea switch (segments: CLI, Industry, Global, Korea). Korea lists the fixture
  // GeekNews / Naver D2 / blog items; the second row (after the summary) names its Korean source.
  await js(`document.querySelectorAll('.c-modal[open] .c-segment__item')[3]?.click()`);
  await wait(300);
  await js(`document.querySelectorAll('.c-modal[open] .c-modal__item')[1]?.click()`);
  await wait(200);
  const krRows = await js<number>(`document.querySelectorAll('.c-modal[open] .c-modal__item').length`);
  const krNote = await js<string>(
    `[...document.querySelectorAll('.c-modal[open] .c-modal__note')].map((n) => n.textContent).join(' ')`,
  );
  if (krRows < 4 || !/GeekNews|Naver D2|카카오|토스|우아한형제들|당근|LY Corporation/.test(krNote))
    return `trends: Korea tab shows ${krRows} rows, detail "${krNote}"`;
  fs.writeFileSync(
    path.join(outDir, 'smoke-trends-korea.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  console.log(
    `[smoke] trends: fetched on open, ${rows.length} CLI rows, ${bullets} added lines, industry "${industry}", korea ${krRows} rows`,
  );
  press(win, 'Escape', []);
  await wait(400);
  return (await js<boolean>(`!!document.querySelector('.c-modal[open]')`))
    ? 'Esc did not close AI trends'
    : null;
}

/**
 * Apply a trend (T64): Korea → the fixture Graphify item → "Apply to project" opens the proposal modal for the
 * focused project: a scan (read-only), then the fixture Claude reply — a partial verdict, an added node, a change and
 * unfit reasons (the `~/.zshrc` step forced there). Now hides the added node; hovering a step dims the others. Cancel
 * drops it. Apply itself (worktree + tab) is not run here: it would make a branch in the user's first project.
 */
async function checkApplyTrend(win: BrowserWindow, outDir: string): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  await js(`document.querySelector('.c-sidebar__foot .c-btn--icon').click()`);
  await wait(400);
  await js(`document.querySelectorAll('.c-modal[open] .c-segment__item')[1]?.click()`); // Industry
  await wait(200);
  await js(`document.querySelectorAll('.c-modal[open] .c-segment__item')[3]?.click()`); // Korea
  await wait(300);
  const picked = await js<boolean>(`(() => {
    const row = [...document.querySelectorAll('.c-modal[open] .c-modal__item')].find((el) => /Graphify/.test(el.textContent));
    row?.click();
    return !!row;
  })()`);
  if (!picked) return 'apply: no Graphify item in the Korea tab';
  await wait(200);
  const clicked = await js<boolean>(`(() => {
    const b = [...document.querySelectorAll('.c-modal[open] .c-btn')].find((el) => /Apply to project|프로젝트에 적용/.test(el.textContent));
    b?.click();
    return !!b;
  })()`);
  if (!clicked) return 'apply: no "Apply to project" button on the trend';
  let verdict = '';
  for (let i = 0; i < 40 && !verdict; i++) {
    await wait(150);
    verdict = await js<string>(
      `document.querySelector('.c-modal[open] [class*="c-badge--verdict-"]')?.className ?? ''`,
    );
  }
  if (!/verdict-partial/.test(verdict)) {
    const note = await js<string>(
      `document.querySelector('.c-modal[open]')?.textContent?.slice(0, 300) ?? ''`,
    );
    return `apply: no partial verdict (badge "${verdict}", modal "${note}")`;
  }
  const after = await js<{
    add: number;
    change: number;
    unfit: number;
    steps: number;
    unfitText: string;
  }>(`(() => {
    const m = document.querySelector('.c-modal[open]');
    const n = (k) => m.querySelectorAll('.c-graph__node[data-mark="' + k + '"]').length;
    return { add: n('add'), change: n('change'), unfit: n('unfit'), steps: m.querySelectorAll('.c-steps__item').length,
      unfitText: [...m.querySelectorAll('.c-modal__bullets li')].map((li) => li.textContent).join(' | ') };
  })()`);
  if (
    after.add < 1 ||
    after.change < 1 ||
    after.unfit < 1 ||
    after.steps !== 3 ||
    !/gfy alias/.test(after.unfitText)
  )
    return `apply: After view ${JSON.stringify(after)}, expected an added node, a change, an unfit node, 3 steps, the alias unfit`;
  fs.writeFileSync(path.join(outDir, 'smoke-apply.png'), (await win.webContents.capturePage()).toPNG());
  // Hover the second step (the skill): nodes it doesn't touch fade.
  await js(
    `document.querySelectorAll('.c-modal[open] .c-steps__item')[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`,
  );
  await wait(150);
  const dimmed = await js<number>(
    `document.querySelectorAll('.c-modal[open] .c-graph__node[data-dim]').length`,
  );
  const lit = await js<number>(
    `document.querySelectorAll('.c-modal[open] .c-graph__node[data-highlight]').length`,
  );
  if (!dimmed || !lit) return `apply: hovering a step lit ${lit} and dimmed ${dimmed} nodes`;
  await js(
    `document.querySelectorAll('.c-modal[open] .c-steps__item')[1].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`,
  );
  // Now: same layout, no marks, the added nodes gone.
  await js(
    `[...document.querySelectorAll('.c-modal[open] .c-segment__item')].find((el) => /^(Now|지금)$/.test(el.textContent))?.click()`,
  );
  await wait(150);
  const now = await js<number>(
    `document.querySelectorAll('.c-modal[open] .c-graph__node[data-mark]').length`,
  );
  if (now) return `apply: Now view still shows ${now} marks`;
  fs.writeFileSync(path.join(outDir, 'smoke-apply-now.png'), (await win.webContents.capturePage()).toPNG());
  // Edit: titles become inputs, a request field appears.
  await js(
    `[...document.querySelectorAll('.c-modal[open] .c-btn')].find((el) => /^(Edit|수정)$/.test(el.textContent))?.click()`,
  );
  await wait(150);
  const inputs = await js<number>(
    `document.querySelectorAll('.c-modal[open] .c-steps__item .c-input').length`,
  );
  const request = await js<boolean>(`!!document.querySelector('.c-modal[open] textarea')`);
  if (inputs !== 3 || !request) return `apply: Edit shows ${inputs} title inputs, request field ${request}`;
  await js(
    `[...document.querySelectorAll('.c-modal[open] .c-btn')].find((el) => /^(Back|돌아가기)$/.test(el.textContent))?.click()`,
  );
  await wait(100);
  await js(
    `[...document.querySelectorAll('.c-modal[open] .c-btn')].find((el) => /^(Cancel|취소)$/.test(el.textContent))?.click()`,
  );
  await wait(400);
  if (await js<boolean>(`!!document.querySelector('.c-modal[open]')`))
    return 'apply: Cancel did not close the modal';
  console.log(
    `[smoke] apply: partial, ${after.add} added, ${after.change} changed, ${after.unfit} unfit node, ${after.steps} steps`,
  );
  return null;
}

/**
 * A link clicked in a terminal (a URL or Claude's OSC 8 link → `window.open`) goes to the default browser and never
 * becomes a (blank) window of the app; a page navigation away from the app is stopped. Returns an error or null.
 */
async function checkLinks(win: BrowserWindow): Promise<string | null> {
  const windows = BrowserWindow.getAllWindows().length;
  const page = win.webContents.getURL();
  smokeLinks.length = 0;
  await win.webContents.executeJavaScript(`window.open('https://example.com/aquila-smoke-link'); undefined`);
  await win.webContents.executeJavaScript(`window.open('file:///etc/hosts'); undefined`);
  await win.webContents.executeJavaScript(`location.href = 'https://example.com/aquila-smoke-nav'; undefined`);
  await wait(500);
  if (BrowserWindow.getAllWindows().length !== windows) return 'links: a link opened a window of the app';
  if (win.webContents.getURL() !== page) return `links: the app page navigated to ${win.webContents.getURL()}`;
  const want = ['https://example.com/aquila-smoke-link', 'https://example.com/aquila-smoke-nav'];
  if (smokeLinks.join() !== want.join())
    return `links: sent to the browser ${JSON.stringify(smokeLinks)}, expected ${JSON.stringify(want)}`;
  console.log('[smoke] links: window.open and navigation go to the browser (http only), no app window');
  return null;
}

/**
 * ⌘/ opens the guide: a list of features, the first one selected with its detail; the last item shows the full
 * shortcut sheet. Saves both screenshots, then Esc closes it. Returns an error or null.
 */
async function checkGuide(win: BrowserWindow, outDir: string): Promise<string | null> {
  win.show();
  win.focus();
  press(win, '/', ['meta']);
  await wait(500);
  const items: number = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.c-modal[open] .c-modal__item').length`,
  );
  if (items < 10) {
    const open: string = await win.webContents.executeJavaScript(
      `[...document.querySelectorAll('.c-modal[open]')].map((m) => m.querySelector('.c-modal__title, h2')?.textContent ?? '?').join(' | ')`,
    );
    return `guide (⌘/) lists ${items} features, expected at least 10 (open: ${open || 'no modal'})`;
  }
  const heading: string = await win.webContents.executeJavaScript(
    `document.querySelector('.c-modal[open] .c-modal__heading')?.textContent ?? ''`,
  );
  if (!heading) return 'guide shows no detail for the selected feature';
  await wait(300); // let the modal finish rising in
  fs.writeFileSync(path.join(outDir, 'smoke-guide.png'), (await win.webContents.capturePage()).toPNG());
  // T24: every feature but the last (the shortcut sheet) shows its captured media, not the placeholder.
  const noMedia: string[] = await win.webContents.executeJavaScript(`(async () => {
    const all = [...document.querySelectorAll('.c-modal[open] .c-modal__item')].slice(0, -1);
    const missing = [];
    for (const item of all) {
      item.click();
      // Up to 1 s for this item's selection to render (2 frames is too tight while the renderer is busy), then
      // its media must be there — not the previous item's, which is still up until the selection renders.
      for (let i = 0; i < 20 && item.getAttribute('aria-selected') !== 'true'; i++)
        await new Promise((r) => setTimeout(r, 50));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!document.querySelector('.c-modal[open] .c-media__frame')) missing.push(item.textContent.trim());
    }
    all[0]?.click();
    return missing;
  })()`);
  if (noMedia.length) return `guide items without media (run \`npm run capture\`): ${noMedia.join(', ')}`;
  const rows: number = await win.webContents.executeJavaScript(`(() => {
    const all = document.querySelectorAll('.c-modal[open] .c-modal__item');
    all[all.length - 1]?.click();
    return new Promise((r) => requestAnimationFrame(() =>
      r(document.querySelectorAll('.c-modal[open] .c-shortcuts__row').length)));
  })()`);
  if (rows < 10) return `guide shortcut sheet shows ${rows} rows, expected at least 10`;
  fs.writeFileSync(
    path.join(outDir, 'smoke-guide-shortcuts.png'),
    (await win.webContents.capturePage()).toPNG(),
  );
  console.log(`[smoke] guide: ${items} features, "${heading}" first, ${rows} shortcut rows`);
  press(win, 'Escape', []);
  await wait(400);
  const stillOpen: boolean = await win.webContents.executeJavaScript(
    `!!document.querySelector('.c-modal[open]')`,
  );
  return stillOpen ? 'Esc did not close the guide' : null;
}

/**
 * ⌘K → "What's new" (T27) opens the release notes: headlines grouped by version, the first one with its media;
 * "How to use" closes it and opens the guide at that headline's item. Screenshot, then Esc closes the guide.
 */
async function checkWhatsNew(win: BrowserWindow, config: Config, out: string): Promise<string | null> {
  const t = translator(config.language);
  const clicked = await paletteRun(win, t('notes.title'));
  if (!clicked) return `palette has no "${t('notes.title')}" action`;
  await wait(600);
  const seen: { items: number; groups: number; media: boolean; heading: string } = await win.webContents
    .executeJavaScript(`(() => {
      const m = document.querySelector('.c-modal[open]');
      return {
        items: m ? m.querySelectorAll('.c-modal__item').length : 0,
        groups: m ? m.querySelectorAll('[role="group"]').length : 0,
        media: !!m?.querySelector('.c-media__frame'),
        heading: m?.querySelector('.c-modal__heading')?.textContent ?? '',
      };
    })()`);
  if (seen.items < 3) return `what's new lists ${seen.items} headlines, expected at least 3`;
  if (!seen.media) return `what's new: "${seen.heading}" shows no media`;
  await wait(300);
  fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
  const guideHeading: string = await win.webContents.executeJavaScript(`(async () => {
    const btn = [...document.querySelectorAll('.c-modal[open] .c-modal__actions button')]
      .find((b) => b.textContent === ${JSON.stringify(t('notes.howTo'))});
    btn?.click();
    await new Promise((r) => setTimeout(r, 400));
    const open = [...document.querySelectorAll('.c-modal[open]')];
    return open.length === 1 ? open[0].querySelector('.c-modal__heading')?.textContent ?? '' : '';
  })()`);
  if (!guideHeading) return `"${t('notes.howTo')}" did not open the guide alone`;
  console.log(
    `[smoke] what's new: ${seen.items} headlines in ${seen.groups} versions, "${seen.heading}" → guide "${guideHeading}", screenshot: ${out}`,
  );
  press(win, 'Escape', []);
  await wait(400);
  const stillOpen: boolean = await win.webContents.executeJavaScript(
    `!!document.querySelector('.c-modal[open]')`,
  );
  return stillOpen ? "Esc did not close the guide opened from what's new" : null;
}

/** CDP modifier bits. */
const CTRL = 2;
const META = 4;

/**
 * Korean IME scenarios (T18). Composition goes through Chromium's real IME path (`Input.imeSetComposition` /
 * `Input.insertText`, so xterm sees compositionstart/update/end and the textarea changes), keys through
 * `Input.dispatchKeyEvent` with the keyCode 229 the IME gives them. Each scenario checks the exact bytes the
 * terminal wrote to its session. Returns an error or null.
 */
async function checkIme(win: BrowserWindow): Promise<string | null> {
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  const cdp = (method: string, params: object = {}) => dbg.sendCommand(method, params);
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

  let written = '';
  const record = (_e: unknown, { data }: { id: string; data: string }) => (written += data);
  ipcMain.on(IPC.sessionWrite, record);

  const compose = async (...steps: string[]) => {
    for (const text of steps)
      await cdp('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  };
  const commit = (text: string) => cdp('Input.insertText', { text });
  const key = async (
    o: { key: string; code: string; keyCode: number; modifiers?: number; text?: string },
    phases: ('down' | 'up')[] = ['down', 'up'],
  ) => {
    const base = {
      key: o.key,
      code: o.code,
      windowsVirtualKeyCode: o.keyCode,
      nativeVirtualKeyCode: o.keyCode,
      modifiers: o.modifiers ?? 0,
    };
    if (phases.includes('down')) {
      await cdp('Input.dispatchKeyEvent', {
        type: o.text ? 'keyDown' : 'rawKeyDown',
        text: o.text,
        unmodifiedText: o.text,
        ...base,
      });
    }
    if (phases.includes('up')) await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  };
  const ENTER = { key: 'Enter', code: 'Enter', keyCode: 13, text: '\r' };
  const ENTER_229 = { key: 'Enter', code: 'Enter', keyCode: 229 };
  const CTRL_C = { key: 'ㅊ', code: 'KeyC', keyCode: 67, modifiers: CTRL };
  const CTRL_C_229 = { ...CTRL_C, keyCode: 229 };

  const focusTerminal = () =>
    win.webContents.executeJavaScript(`(() => {
      const ta = [...document.querySelectorAll('.term-host:not([hidden]) .xterm-helper-textarea')].pop();
      ta?.focus();
      return document.activeElement === ta;
    })()`);
  const compositionView = (): Promise<{ active: boolean; text: string }> =>
    win.webContents.executeJavaScript(`(() => {
      const v = document.activeElement?.closest('.xterm')?.querySelector('.composition-view');
      return { active: !!v?.classList.contains('active'), text: v?.textContent ?? '' };
    })()`);

  const scenarios: { name: string; expect: string; run: () => Promise<string | void> }[] = [
    {
      name: 'jamo: ㅎ→하→한, ㄱ→그→글 commits as 한글',
      expect: '한글',
      run: async () => {
        await compose('ㅎ', '하', '한');
        await commit('한');
        await compose('ㄱ', '그', '글');
        await commit('글');
      },
    },
    {
      name: 'final consonant moves on: 한 + ㅏ → 하나 (no duplicate 한)',
      expect: '하나',
      run: async () => {
        await compose('ㅎ', '하', '한');
        await commit('하');
        await compose('나');
        await commit('나');
      },
    },
    {
      name: 'composition shown while typing',
      expect: '하',
      run: async () => {
        await compose('ㅎ', '하');
        await wait(50);
        const v = await compositionView();
        await commit('하');
        if (!v.active || v.text !== '하')
          return `composition view ${JSON.stringify(v)}, expected active "하"`;
      },
    },
    {
      name: 'Enter during composition (keydown 229, commit, keydown 13 — macOS Chromium)',
      expect: '글\r',
      run: async () => {
        await compose('ㄱ', '그', '글');
        await key(ENTER_229, ['down']);
        await commit('글');
        await key(ENTER);
        await key(ENTER_229, ['up']);
      },
    },
    {
      name: 'Enter during composition (only keydown 229, then commit)',
      expect: '글\r',
      run: async () => {
        await compose('글');
        await key(ENTER_229);
        await commit('글');
      },
    },
    {
      name: 'Enter after commit',
      expect: '글\r',
      run: async () => {
        await compose('글');
        await commit('글');
        await key(ENTER);
      },
    },
    {
      name: 'Space during composition',
      expect: '글 ',
      run: async () => {
        await compose('글');
        await commit('글');
        await key({ key: ' ', code: 'Space', keyCode: 32, text: ' ' });
      },
    },
    {
      name: 'Ctrl+C during composition (keydown 229, commit, echo keydown 67)',
      expect: '하\x03',
      run: async () => {
        await compose('하');
        await key(CTRL_C_229, ['down']);
        await commit('하');
        await key(CTRL_C);
        await key(CTRL_C_229, ['up']);
      },
    },
    {
      name: 'Ctrl+C right after 한/영 switch (key "ㅊ", keyCode 67)',
      expect: '\x03',
      run: () => key(CTRL_C),
    },
    {
      name: 'Ctrl+C right after 한/영 switch (keyCode 229, not composing)',
      expect: '\x03',
      run: () => key(CTRL_C_229),
    },
  ];

  try {
    if (!(await focusTerminal())) return 'IME: could not focus a terminal';
    // Start from a clean line in the shell; the scenarios' Enters run "글" as a (missing) command, harmless.
    await key(CTRL_C);
    await wait(300);
    for (const s of scenarios) {
      written = '';
      const err = await s.run();
      await wait(300); // xterm's 0 ms commit timers, our 150 ms fallback, IPC
      if (err) return `IME "${s.name}": ${err}`;
      if (written !== s.expect) {
        return `IME "${s.name}": sent ${JSON.stringify(written)}, expected ${JSON.stringify(s.expect)}`;
      }
      console.log(`[smoke] IME ok: ${s.name}`);
    }
    // ⌘ shortcut with the Korean input source on: ⌘K arrives as key "ㅏ", code KeyK.
    await key({ key: 'ㅏ', code: 'KeyK', keyCode: 75, modifiers: META });
    await wait(400);
    const palette: boolean = await win.webContents.executeJavaScript(
      `!!document.querySelector('.c-palette__item')`,
    );
    if (!palette) return 'IME: ⌘K with the Korean input source ("ㅏ") did not open the palette';
    press(win, 'Escape', []);
    await wait(300);
    console.log('[smoke] IME ok: ⌘K as "ㅏ" opens the palette');
    return null;
  } finally {
    ipcMain.removeListener(IPC.sessionWrite, record);
    dbg.detach();
  }
}
