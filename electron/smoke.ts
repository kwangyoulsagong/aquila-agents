// `npm run smoke`: launch the built app, open a shell session, check the pty round-trips,
// check OSC 7501 (main answers the query; a report becomes the session status), check Ctrl+C stops a `yes` flood fast, open shells from the UI and check WebGL runs only on terminals on screen, save a screenshot to dist/smoke.png, then quit with exit code 0 (ok) or 1 (fail).
// Agents use this to verify their change actually runs.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { SessionManager } from './sessions';
import type { Config } from '../src/shared/api/types';

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
const TIMEOUT_MS = 25000;

export const isSmoke = process.env.AQUILA_SMOKE === '1';

/** Wrap the session `send` so smoke can watch pty output and status. */
export function watchOutput(
  send: (ch: string, p: unknown) => void,
  onData: (data: string) => void,
  onStatus: (status: string) => void = () => {},
) {
  return (channel: string, payload: unknown) => {
    if (channel === 'session:data') onData((payload as { data: string }).data);
    if (channel === 'session:status') onStatus((payload as { status: string }).status);
    send(channel, payload);
  };
}

export async function runSmoke(
  win: BrowserWindow,
  sessions: SessionManager,
  config: Config,
  output: { buffer: string; statuses: string[] },
) {
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
    const onPath = (bin: string) =>
      (process.env.PATH ?? '').split(':').some((dir) => dir && fs.existsSync(path.join(dir, bin)));
    console.log(`[smoke] PATH has claude: ${onPath('claude')}, codex: ${onPath('codex')}`);
    console.log(`[smoke] OK — pty round-trip, OSC 7501 and Ctrl+C under load work, screenshot: ${out}`);
    sessions.killAll();
    app.exit(0);
  }, 200);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function press(win: BrowserWindow, keyCode: string, modifiers: Electron.InputEvent['modifiers']) {
  for (const type of ['keyDown', 'keyUp'] as const) win.webContents.sendInputEvent({ type, keyCode, modifiers });
}

/** Per mounted terminal: on screen, and rendering with WebGL (its canvas) or the DOM renderer (`.xterm-rows`). */
async function terminals(win: BrowserWindow): Promise<{ visible: boolean; webgl: boolean }[]> {
  return win.webContents.executeJavaScript(`[...document.querySelectorAll('.term-host')].map((h) => ({
    visible: !h.hidden,
    webgl: !!h.querySelector('.xterm-screen canvas') && !h.querySelector('.xterm-rows'),
  }))`);
}

/**
 * Two shells, switch tabs, split: WebGL must be on exactly the terminals on screen. Returns an error or null.
 * Leaves the app split with two shells (the screenshot).
 */
async function checkGpuFollowsScreen(win: BrowserWindow): Promise<string | null> {
  const expect = async (step: string, visible: number) => {
    const ts = await terminals(win);
    console.log(`[smoke] ${step}: ${JSON.stringify(ts)}`);
    if (ts.filter((t) => t.visible).length !== visible) return `${step}: expected ${visible} terminal(s) on screen`;
    if (ts.some((t) => t.visible !== t.webgl)) return `${step}: WebGL should be on exactly the visible terminals`;
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
