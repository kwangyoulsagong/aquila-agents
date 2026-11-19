// `npm run smoke`: launch the built app, open a shell session, check the pty round-trips,
// check OSC 7501 (main answers the query; a report becomes the session status), check Ctrl+C stops a `yes` flood fast, open shells from the UI and check terminals on screen render with WebGL, save a screenshot to dist/smoke.png,
// open the first-run checklist from ⌘K (dist/smoke-first-run.png), run the Korean IME scenarios (real composition
// events through Chromium's IME path via CDP; checks the exact bytes the terminal sends), then quit with exit code 0 (ok) or 1 (fail).
// Agents use this to verify their change actually runs.
import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, type BrowserWindow } from 'electron';
import { runPerf } from './perf';
import type { SessionManager } from './sessions';
import { IPC, type Config } from '../src/shared/api/types';
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
  if (process.env.AQUILA_PERF === '1') return runPerf(win, sessions);
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
    const firstRunError = await checkFirstRun(win, config, path.join(outDir, 'smoke-first-run.png'));
    if (firstRunError) return fail(firstRunError);
    const imeError = await checkIme(win);
    if (imeError) return fail(imeError);
    console.log(
      `[smoke] OK — pty round-trip, OSC 7501, Ctrl+C under load and Korean IME work, screenshot: ${out}`,
    );
    sessions.killAll();
    app.exit(0);
  }, 200);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
