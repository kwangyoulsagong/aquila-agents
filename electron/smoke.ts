// `npm run smoke`: launch the built app, open a shell session, check the pty round-trips,
// check OSC 7501 (main answers the query; a report becomes the session status), check Ctrl+C stops a `yes` flood fast, open shells from the UI and check terminals on screen render with WebGL, save a screenshot to dist/smoke.png,
// open the first-run checklist from ⌘K (dist/smoke-first-run.png), project settings from ⌘K (dist/smoke-settings.png, Figma on: dist/smoke-settings-figma.png), open the guide with ⌘/ (dist/smoke-guide.png,
// dist/smoke-guide-shortcuts.png; every feature must show captured media), ⌘K → What's new (dist/smoke-whats-new.png;
// headlines with media, "How to use" opens the guide at that item), run the Korean IME scenarios (real composition
// events through Chromium's IME path via CDP; checks the exact bytes the terminal sends), then quit with exit code 0 (ok) or 1 (fail).
// Agents use this to verify their change actually runs.
import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, type BrowserWindow } from 'electron';
import { runCapture } from './capture';
import type { PreviewViews } from './preview';
import { runPerf } from './perf';
import type { SessionManager } from './sessions';
import { checkRemoteSession } from './remote/smoke';
import { IPC, type Config, type ConnectionUpdate } from '../src/shared/api/types';
import { translator } from '../src/shared/i18n/dictionary';

const MARKER = 'AQUILA_SMOKE_OK';
/** Printed by the shell only when it read our 7501 reply; computed so the echoed command never matches. */
const OSC_MARKER = 'AQUILA_7501_42';
const OSC_CHECK =
  "printf '\\033]7501;?\\007'; IFS= read -rs -t 3 -d '\\' r; " +
  'case "$r" in *states=*) echo AQUILA_7501_$((40+2));; esac; ' +
  "printf '\\033]7501;state=working:app=smoke\\007'\r";
/** `yes` floods the pty; after Ctrl+C the shell must answer within YES_BUDGET_MS (flow control keeps it responsive). */
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
) {
  if (process.env.AQUILA_PERF === '1') return runPerf(win, sessions);
  if (process.env.AQUILA_CAPTURE) return runCapture(win, sessions, config, previews);
  const fail = (why: string) => {
    console.error(`[smoke] FAIL: ${why}`);
    app.exit(1);
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
    const onPath = (bin: string) =>
      (process.env.PATH ?? '').split(':').some((dir) => dir && fs.existsSync(path.join(dir, bin)));
    console.log(`[smoke] PATH has claude: ${onPath('claude')}, codex: ${onPath('codex')}`);
    const firstRunError = await checkFirstRun(win, config, path.join(outDir, 'smoke-first-run.png'));
    if (firstRunError) return fail(firstRunError);
    const settingsError = await checkProjectSettings(win, config, path.join(outDir, 'smoke-settings.png'));
    if (settingsError) return fail(settingsError);
    const guideError = await checkGuide(win, outDir);
    if (guideError) return fail(guideError);
    const notesError = await checkWhatsNew(win, config, path.join(outDir, 'smoke-whats-new.png'));
    if (notesError) return fail(notesError);
    const trendsError = await checkTrends(win, outDir);
    if (trendsError) return fail(trendsError);
    const imeError = await checkIme(win);
    if (imeError) return fail(imeError);
    const previewError = previews ? await checkPreviewPick(previews) : 'no preview views';
    if (previewError) return fail(previewError);
    const remoteError = await checkRemoteSession(sessions, config, output);
    if (remoteError) return fail(remoteError);
    console.log(
      `[smoke] OK — pty round-trip, OSC 7501, Ctrl+C under load, Korean IME, preview pick and remote reconnect work, screenshot: ${out}`,
    );
    sessions.killAll();
    app.exit(0);
  }, 200);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
 * ⌘K → "Setup checklist": the first-run dialog opens with PATH, claude, codex, git, projects and login rows.
 * Saves a screenshot, then closes it with Esc (smoke never writes ~/.aquila/first-run.json). Returns an error or null.
 */
async function checkFirstRun(win: BrowserWindow, config: Config, out: string): Promise<string | null> {
  const label = translator(config.language)('firstRun.checklist');
  // The palette runs its command in requestAnimationFrame, which an occluded window doesn't fire.
  win.show();
  win.focus();
  press(win, 'K', ['meta']);
  await wait(500);
  const clicked: boolean = await win.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('.c-palette__item')].find((el) => el.textContent === ${JSON.stringify(label)});
    item?.click();
    return !!item;
  })()`);
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

/** ⌘K → "Project settings…" opens the settings dialog with its fields; screenshot, then Esc closes it (nothing saved). */
async function checkProjectSettings(win: BrowserWindow, config: Config, out: string): Promise<string | null> {
  const label = translator(config.language)('settings.action');
  win.show();
  win.focus();
  press(win, 'K', ['meta']);
  await wait(500);
  const clicked: boolean = await win.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('.c-palette__item')].find((el) => el.textContent === ${JSON.stringify(label)});
    item?.click();
    return !!item;
  })()`);
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
 * T35: nothing is fetched until ✦ is clicked; opening the modal fetches the (fixture) feeds — Claude 2.1.327 installed
 * → 2.1.329 and 2.1.328 newer. Checks the CLI rows and their "Added" lines, and the Industry tab.
 */
async function checkTrends(win: BrowserWindow, outDir: string): Promise<string | null> {
  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code) as Promise<T>;
  const button = `document.querySelector('.c-sidebar__drag .c-btn')`;
  if (!(await js<boolean>(`!!${button}`))) return 'trends: no ✦ button in the sidebar top band';
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
  console.log(
    `[smoke] trends: fetched on open, ${rows.length} CLI rows, ${bullets} added lines, industry "${industry}"`,
  );
  press(win, 'Escape', []);
  await wait(400);
  return (await js<boolean>(`!!document.querySelector('.c-modal[open]')`))
    ? 'Esc did not close AI trends'
    : null;
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
  win.show();
  win.focus();
  press(win, 'K', ['meta']);
  await wait(500);
  const clicked: boolean = await win.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('.c-palette__item')].find((el) => el.textContent === ${JSON.stringify(t('notes.title'))});
    item?.click();
    return !!item;
  })()`);
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
