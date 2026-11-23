// `npm run smoke`: launch the built app, open a shell session, check the pty round-trips,
// check OSC 7501 (main answers the query; a report becomes the session status), check Ctrl+C stops a `yes` flood fast, open shells from the UI and check terminals on screen render with WebGL, save a screenshot to dist/smoke.png,
// open the first-run checklist from ⌘K (dist/smoke-first-run.png), project settings from ⌘K (dist/smoke-settings.png, Figma on: dist/smoke-settings-figma.png), the global shortcut dialog from ⌘K (dist/smoke-global-shortcut.png), open the guide with ⌘/ (dist/smoke-guide.png,
// dist/smoke-guide-shortcuts.png; every feature must show captured media), ⌘K → What's new (dist/smoke-whats-new.png;
// headlines with media, "How to use" opens the guide at that item), run the Korean IME scenarios (real composition
// events through Chromium's IME path via CDP; checks the exact bytes the terminal sends), then quit with exit code 0 (ok) or 1 (fail).
// Agents use this to verify their change actually runs.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, clipboard, ClipboardItem, ipcMain } from 'electron';
import { showContextMenu } from './menu';
import { runCapture } from './capture';
import type { PreviewViews } from './preview';
import { runId, type RunManager } from './runs';
import { runPerf } from './perf';
import type { SessionManager } from './sessions';
import { checkRemoteSession } from './remote/smoke';
import { checkRealHost } from './remote/realHostSmoke';
import { readHookBody } from './hooks';
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
    const notesError = await checkWhatsNew(win, config, path.join(outDir, 'smoke-whats-new.png'));
    if (notesError) return fail(notesError);
    const trendsError = await checkTrends(win, outDir);
    if (trendsError) return fail(trendsError);
    const applyError = await checkApplyTrend(win, outDir);
    if (applyError) return fail(applyError);
    const sourcesError = await checkGraphSources(win, config, path.join(outDir, 'smoke-sources.png'));
    if (sourcesError) return fail(sourcesError);
    const imeError = await checkIme(win);
    if (imeError) return fail(imeError);
    const reviewError = await checkReviewQueue(win, sessions, outDir);
    if (reviewError) return fail(reviewError);
    const runError = runs ? await checkRunSlot(win, runs, config, outDir) : 'no run manager';
    if (runError) return fail(runError);
    const previewError = previews ? await checkPreviewPick(previews) : 'no preview views';
    if (previewError) return fail(previewError);
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
    await win.webContents.executeJavaScript(`window.aquila.graphAddSource(${JSON.stringify(path.join(fixtures, dir))})`);
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
  console.log(`[smoke] note sources: 3 folders indexed in the worker, DB-12 links two notes, screenshot: ${out}`);
  press(win, 'Escape', []);
  await wait(400);
  return null;
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
  // GeekNews / AI타임스 / blog items; the second row (after the summary) names its Korean source.
  await js(`document.querySelectorAll('.c-modal[open] .c-segment__item')[3]?.click()`);
  await wait(300);
  await js(`document.querySelectorAll('.c-modal[open] .c-modal__item')[1]?.click()`);
  await wait(200);
  const krRows = await js<number>(`document.querySelectorAll('.c-modal[open] .c-modal__item').length`);
  const krNote = await js<string>(
    `[...document.querySelectorAll('.c-modal[open] .c-modal__note')].map((n) => n.textContent).join(' ')`,
  );
  if (krRows < 4 || !/GeekNews|AI타임스|카카오|토스|우아한형제들|당근|LY Corporation/.test(krNote))
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
    verdict = await js<string>(`document.querySelector('.c-modal[open] [class*="c-badge--verdict-"]')?.className ?? ''`);
  }
  if (!/verdict-partial/.test(verdict)) {
    const note = await js<string>(`document.querySelector('.c-modal[open]')?.textContent?.slice(0, 300) ?? ''`);
    return `apply: no partial verdict (badge "${verdict}", modal "${note}")`;
  }
  const after = await js<{ add: number; change: number; unfit: number; steps: number; unfitText: string }>(`(() => {
    const m = document.querySelector('.c-modal[open]');
    const n = (k) => m.querySelectorAll('.c-graph__node[data-mark="' + k + '"]').length;
    return { add: n('add'), change: n('change'), unfit: n('unfit'), steps: m.querySelectorAll('.c-steps__item').length,
      unfitText: [...m.querySelectorAll('.c-modal__bullets li')].map((li) => li.textContent).join(' | ') };
  })()`);
  if (after.add < 1 || after.change < 1 || after.unfit < 1 || after.steps !== 3 || !/gfy alias/.test(after.unfitText))
    return `apply: After view ${JSON.stringify(after)}, expected an added node, a change, an unfit node, 3 steps, the alias unfit`;
  fs.writeFileSync(path.join(outDir, 'smoke-apply.png'), (await win.webContents.capturePage()).toPNG());
  // Hover the second step (the skill): nodes it doesn't touch fade.
  await js(`document.querySelectorAll('.c-modal[open] .c-steps__item')[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
  await wait(150);
  const dimmed = await js<number>(`document.querySelectorAll('.c-modal[open] .c-graph__node[data-dim]').length`);
  const lit = await js<number>(`document.querySelectorAll('.c-modal[open] .c-graph__node[data-highlight]').length`);
  if (!dimmed || !lit) return `apply: hovering a step lit ${lit} and dimmed ${dimmed} nodes`;
  await js(`document.querySelectorAll('.c-modal[open] .c-steps__item')[1].dispatchEvent(new MouseEvent('mouseout', { bubbles: true }))`);
  // Now: same layout, no marks, the added nodes gone.
  await js(`[...document.querySelectorAll('.c-modal[open] .c-segment__item')].find((el) => /^(Now|지금)$/.test(el.textContent))?.click()`);
  await wait(150);
  const now = await js<number>(`document.querySelectorAll('.c-modal[open] .c-graph__node[data-mark]').length`);
  if (now) return `apply: Now view still shows ${now} marks`;
  fs.writeFileSync(path.join(outDir, 'smoke-apply-now.png'), (await win.webContents.capturePage()).toPNG());
  // Edit: titles become inputs, a request field appears.
  await js(`[...document.querySelectorAll('.c-modal[open] .c-btn')].find((el) => /^(Edit|수정)$/.test(el.textContent))?.click()`);
  await wait(150);
  const inputs = await js<number>(`document.querySelectorAll('.c-modal[open] .c-steps__item .c-input').length`);
  const request = await js<boolean>(`!!document.querySelector('.c-modal[open] textarea')`);
  if (inputs !== 3 || !request) return `apply: Edit shows ${inputs} title inputs, request field ${request}`;
  await js(`[...document.querySelectorAll('.c-modal[open] .c-btn')].find((el) => /^(Back|돌아가기)$/.test(el.textContent))?.click()`);
  await wait(100);
  await js(`[...document.querySelectorAll('.c-modal[open] .c-btn')].find((el) => /^(Cancel|취소)$/.test(el.textContent))?.click()`);
  await wait(400);
  if (await js<boolean>(`!!document.querySelector('.c-modal[open]')`)) return 'apply: Cancel did not close the modal';
  console.log(`[smoke] apply: partial, ${after.add} added, ${after.change} changed, ${after.unfit} unfit node, ${after.steps} steps`);
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
  if (items < 10) return `guide (⌘/) lists ${items} features, expected at least 10`;
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
