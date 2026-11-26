// `npm run capture` (T24): stage a demo state per guide item and capture it into src/features/guide/media/ as
// `<id>.<lang>.webp` (still) and, for items that move, `<id>.<lang>.webm` (short loop; the WebP is its poster).
// Runs inside the smoke harness under a throwaway fixture HOME (scripts/capture/capture.sh): fixture shell prompt,
// demo `claude`/`codex` that report status with OSC 7501, demo git projects — never real user data.
// Frames come from `capturePage(rect)`; a hidden window encodes them with Chromium's MediaRecorder (VP9 WebM) and
// canvas WebP, so no external encoder is needed.
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, nativeImage, type NativeImage, type Rectangle } from 'electron';
import type { SessionManager } from './sessions';
import type { PreviewViews } from './preview';
import type { Config } from '../src/shared/api/types';
import { translator } from '../src/shared/i18n/dictionary';

/** Window content size while capturing (16:10, like the guide's media frame). */
const WIN = { width: 1440, height: 900 };
/** Output size: 2× the ~480 px wide media frame in the guide. */
const OUT = { width: 960, height: 600 };
const FPS = 12;
/** Budget: loops 3–5 s, files small enough to bundle (21 items × 2 languages). */
export const CAPTURE_BUDGET = { maxClipMs: 5000, maxVideoBytes: 700 * 1024, maxStillBytes: 250 * 1024 };
/** Mostly still UI: 450 kbps keeps 11 px text legible at about half the size of 900. */
const VIDEO_KBPS = 450;

const FULL: Rectangle = { x: 0, y: 0, ...WIN };
/** The demo shop capture.sh serves; its `design.html` stands in for a Figma frame (T62). */
const DESIGN_URL = 'http://127.0.0.1:47173/';
const TOP_LEFT: Rectangle = { x: 0, y: 0, width: 960, height: 600 };
const TOP_RIGHT: Rectangle = { x: 480, y: 0, width: 960, height: 600 };
const SIDEBAR: Rectangle = { x: 0, y: 0, width: 640, height: 400 };
const CENTER: Rectangle = { x: 240, y: 0, width: 960, height: 600 };
/** Centered both ways: a dialog sits in the middle of the window. */
const MIDDLE: Rectangle = { x: 240, y: 150, width: 960, height: 600 };

interface Frame {
  t: number;
  png: Buffer;
}

type Mods = Electron.InputEvent['modifiers'];

interface Scenario {
  /** Guide item id (src/features/guide/model/registry.ts). */
  id: string;
  rect: Rectangle;
  /** Set up the state before capturing (not recorded). */
  stage?: () => Promise<void>;
  /** What the loop shows; omitted = a still. Must fit in `ms`. */
  act?: () => Promise<void>;
  ms?: number;
  /** Frame used as the still (reduced motion, power saver). Default: the last one, the feature's end state. */
  poster?: 'first' | 'last';
  /** Undo what the loop changed (not recorded). */
  after?: () => Promise<void>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** The whole run (17 items) takes ~90 s; a stuck step must not hang forever. */
const TIMEOUT_MS = 240_000;

// Capture runs under the fixture HOME: keep Chromium's profile (local storage, caches) there too, never in the
// real app's Application Support folder. Must happen before `ready`, so at import time.
if (process.env.AQUILA_CAPTURE) {
  app.setPath('userData', path.join(app.getPath('home'), '.capture-profile'));
  // Keep painting behind other windows: macOS occlusion stops requestAnimationFrame, and the palette runs its
  // command in one — a capture window covered by a terminal never opened the dialog it was waiting for, and every
  // scenario after it failed. Same switches as perf.
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'MacWebContentsOcclusion');
}

export async function runCapture(
  win: BrowserWindow,
  sessions: SessionManager,
  config: Config,
  previews?: PreviewViews | null,
) {
  const outDir = process.env.AQUILA_CAPTURE ?? '';
  const lang = config.language;
  const t = translator(lang);
  const fail = (why: string) => {
    console.error(`[capture] FAIL (${lang}): ${why}`);
    void sessions.killAll().finally(() => app.exit(1));
  };
  if (!outDir || !fs.existsSync(outDir)) return fail(`no output folder: ${outDir}`);
  setTimeout(() => fail('timeout'), TIMEOUT_MS).unref();

  const js = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code);
  const press = async (keyCode: string, modifiers: Mods = [], after = 0) => {
    for (const type of ['keyDown', 'keyUp'] as const)
      win.webContents.sendInputEvent({ type, keyCode, modifiers });
    if (after) await wait(after);
  };
  const type = async (text: string, gap: number) => {
    for (const ch of text) {
      win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      await wait(gap);
    }
  };
  /** Click the first matching element, waiting up to 2 s for it to render. */
  const click = async (selector: string, text?: string) => {
    for (let i = 0; i < 20; i++) {
      const ok = await js<boolean>(`(() => {
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})]
          .find((e) => ${text === undefined ? 'true' : `e.textContent.trim() === ${JSON.stringify(text)}`});
        el?.click();
        return !!el;
      })()`);
      if (ok) return;
      await wait(100);
    }
    const seen = await js<string[]>(
      `[...document.querySelectorAll(${JSON.stringify(selector)})].map((e) => e.textContent.trim())`,
    );
    throw new Error(`nothing to click: ${selector} "${text ?? ''}" (found: ${JSON.stringify(seen)})`);
  };
  const center = (selector: string) =>
    js<{ x: number; y: number } | null>(`(() => {
      const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect();
      return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
    })()`);
  const drag = async (from: { x: number; y: number }, dx: number) => {
    const mouse = (type: 'mouseDown' | 'mouseMove' | 'mouseUp', x: number, held: boolean) =>
      win.webContents.sendInputEvent({
        type,
        x,
        y: from.y,
        button: 'left',
        clickCount: 1,
        modifiers: held ? ['leftbuttondown'] : [],
      });
    mouse('mouseMove', from.x, false);
    mouse('mouseDown', from.x, false);
    for (let i = 1; i <= 10; i++) {
      mouse('mouseMove', Math.round(from.x + (dx * i) / 10), true);
      await wait(40);
    }
    mouse('mouseUp', from.x + dx, false);
  };
  const openPalette = () => press('K', ['meta'], 400);
  /** Wait up to 5 s for a renderer condition. */
  const waitFor = async (condition: string, ms = 5000) => {
    for (let i = 0; i < ms / 100; i++) {
      if (await js<boolean>(condition)) return;
      await wait(100);
    }
    const state = await js<string>(`JSON.stringify({
      dialogs: [...document.querySelectorAll('dialog')].map((d) => d.className + (d.open ? ' OPEN' : '') + ' inputs=' + d.querySelectorAll('input').length + ' text=' + (d.textContent || '').slice(0, 60)),
      active: document.activeElement?.className + ' ' + document.activeElement?.tagName,
      palette: [...document.querySelectorAll('.c-palette__item')].slice(0, 5).map((e) => e.textContent),
    })`).catch(() => '?');
    console.log(`[capture] state at the timeout: ${state}`);
    throw new Error(`timed out waiting for ${condition}`);
  };

  const scenarios: Scenario[] = [
    {
      id: 'sessions',
      rect: TOP_LEFT,
      ms: 4800,
      act: async () => {
        await wait(500);
        await press('T', ['meta'], 2800); // demo Claude in web-shop: works, then asks for permission
        await press('T', ['meta', 'alt'], 1200); // a shell next to it
      },
    },
    {
      id: 'status',
      rect: TOP_LEFT,
      stage: async () => {
        await press('2', ['meta'], 300);
        await press('T', ['meta'], 300); // api-server: done
        await press('3', ['meta'], 300);
        await press('T', ['meta'], 300); // docs-site: error
        await press('4', ['meta'], 300);
        await press('T', ['meta', 'shift'], 300); // mobile-app: codex, done
        await press('1', ['meta'], 4500); // back to web-shop; let every demo settle
      },
    },
    {
      id: 'attention',
      rect: TOP_LEFT,
      ms: 4500,
      stage: async () => {
        await press('T', ['meta'], 3500); // a second waiting Claude in web-shop
        await press('2', ['meta'], 600);
      },
      act: async () => {
        await wait(700);
        await press('J', ['meta'], 1700);
        await press('J', ['meta'], 1500);
      },
    },
    {
      // Review queue (T58): the demo sessions that finished off screen in "status" are gathered in the sidebar.
      id: 'review',
      rect: TOP_LEFT,
      stage: async () => {
        await waitFor(`!!document.querySelector('.c-queue')`);
        await wait(300);
      },
    },
    {
      // Global shortcut (T41): ⌘K → the dialog, record a key. Not saved, so nothing is registered with the OS.
      id: 'globalShortcut',
      rect: MIDDLE,
      ms: 4600,
      act: async () => {
        await wait(400);
        await openPalette();
        await type(lang === 'ko' ? '전역' : 'global', 200);
        await wait(500);
        await click('.c-palette__item', t('globalShortcut.menu'));
        await waitFor(`!!document.querySelector('.c-dialog[open] .c-input')`);
        await wait(900);
        await js(`document.querySelector('.c-dialog[open] .c-input')?.focus()`);
        await press('G', ['meta', 'alt'], 1500);
      },
      after: () => press('Escape', [], 400),
    },
    { id: 'notify', rect: TOP_LEFT },
    {
      id: 'palette',
      rect: CENTER,
      ms: 4200,
      act: async () => {
        await wait(400);
        await openPalette();
        await type('api', 220);
        await wait(1200);
      },
      after: () => press('Escape', [], 400),
    },
    {
      id: 'split',
      rect: FULL,
      ms: 4000,
      act: async () => {
        await wait(500);
        await press('D', ['meta'], 700);
        await press('T', ['meta', 'alt'], 2000);
      },
    },
    {
      id: 'focus',
      rect: FULL,
      ms: 4200,
      act: async () => {
        await wait(600);
        await press('Left', ['meta', 'alt'], 1100);
        await press('Right', ['meta', 'alt'], 1100);
        await press('Left', ['meta', 'alt'], 900);
      },
    },
    {
      id: 'resize',
      rect: FULL,
      ms: 4500,
      act: async () => {
        await wait(500);
        const handle = await center('.c-split__divider[data-dir="row"]');
        if (!handle) throw new Error('no divider to drag');
        await drag(handle, -280);
        await wait(700);
        for (let i = 0; i < 3; i++) await press('Right', ['meta', 'alt', 'shift'], 350);
        await wait(800);
      },
    },
    {
      id: 'zoom',
      rect: FULL,
      ms: 4000,
      act: async () => {
        await wait(600);
        await press('Enter', ['meta', 'shift'], 1700);
        await press('Enter', ['meta', 'shift'], 1200);
      },
    },
    {
      // Review loop (T25): open, side by side, comment on a line. Stops before pasting: the demo agent would run it.
      id: 'changes',
      rect: FULL,
      ms: 4800,
      act: async () => {
        await wait(300);
        await press('G', ['meta', 'shift'], 900);
        await click('.c-segment__item', t('changes.mode.split'));
        await wait(700);
        await js(`[...document.querySelectorAll('.c-diff__line--add[data-commentable]')]
          .find((e) => e.textContent.includes('coupon ?'))?.click()`);
        await wait(250);
        await type(lang === 'ko' ? '0 미만 방지 테스트 추가' : 'Add a test for the clamp', 35);
        await wait(200);
        await press('Enter', ['meta'], 1200);
      },
      after: async () => {
        await click('.c-panel__bar .c-btn', t('changes.comments.clear'));
        await click('.c-segment__item', t('changes.mode.unified'));
        await press('G', ['meta', 'shift'], 500);
      },
    },
    {
      // In-app preview (T33): the demo shop from web-shop's launch.json, in Select mode over its button.
      id: 'preview',
      rect: FULL,
      stage: async () => {
        await press('1', ['meta'], 300);
        await press('P', ['meta', 'shift'], 300);
        await waitFor(`!!document.querySelector('.c-preview .c-panel__head .c-row__meta')`);
        await wait(500);
        await click('.c-preview .c-btn', t('preview.pick'));
        await wait(300);
        if (!(await previews?.hover('app', '[data-testid="apply-coupon"]'))) throw new Error('no demo shop');
        await wait(400);
      },
      after: async () => {
        await click('.c-preview .c-btn', t('preview.pick.cancel'));
        await press('P', ['meta', 'shift'], 400);
      },
    },
    {
      // Run slot (T60): web-shop's two fixture commands (a dev server and a test watcher, canned output) started from
      // the panel; both dots green, the dev server's log with "Open in preview".
      id: 'run',
      rect: FULL,
      stage: async () => {
        await press('1', ['meta'], 300);
        await press('R', ['meta', 'shift'], 400);
        await click('.c-runs__item', `test${t('run.state.idle')}`);
        await click('.c-run .c-panel__bar .c-btn', t('run.start'));
        await waitFor(`document.querySelector('.c-run__state .c-dot')?.dataset.status === 'live'`);
        await click('.c-runs__item', `web${t('run.state.idle')}`);
        await click('.c-run .c-panel__bar .c-btn', t('run.start'));
        await waitFor(`(document.querySelector('.c-run .xterm-rows')?.textContent ?? '').includes('Local')`);
        await wait(500);
      },
      after: async () => {
        for (const name of ['web', 'test']) {
          await click('.c-runs__item', `${name}${t('run.state.running')}`);
          await click('.c-run .c-panel__bar .c-btn', t('run.stop'));
          await waitFor(`document.querySelector('.c-run__state .c-dot')?.dataset.status !== 'live'`);
        }
        await press('R', ['meta', 'shift'], 400);
      },
    },
    {
      // Terminal helpers (T28): quick select labels the paths on screen; typing one copies it. Then find (T40):
      // ⌘F, a word on screen, Enter to the next match — the loop ends on the bar with its count.
      id: 'terminal',
      rect: FULL,
      ms: 7000,
      act: async () => {
        await wait(400);
        await press('E', ['meta', 'shift'], 1900);
        await press('A', [], 1700); // the "Copied" note (shown 1.6 s)
        await press('F', ['meta'], 500);
        // Leaving quick select hands focus back to the terminal a beat late, which could take it from the find field:
        // type only once the field has it.
        await waitFor(`!!document.querySelector('.c-term-find input')`);
        await js(`document.querySelector('.c-term-find input')?.focus()`);
        await type('src', 200);
        await press('Enter', [], 600);
        await press('Enter', [], 800);
      },
      // Escape goes to the find bar (it has focus), which closes and hands the terminal back. Never send Escape
      // while the terminal has focus: it would reach the CLI and leave `^[` on screen for every later scene.
      after: async () => {
        await js(`document.querySelector('.c-term-find input')?.focus()`);
        await press('Escape', [], 400);
        await waitFor(`!document.querySelector('.c-term-find')`);
      },
    },
    { id: 'accounts', rect: TOP_RIGHT },
    { id: 'projects', rect: SIDEBAR },
    {
      id: 'firstRun',
      rect: FULL,
      stage: async () => {
        await openPalette();
        await click('.c-palette__item', t('firstRun.checklist'));
        await wait(2500); // checks run, the dialog rises in
      },
      after: () => press('Escape', [], 500),
    },
    {
      // Figma you can find (T54): ⌘K "Connect Figma…" opens project settings with Figma switched on and in view.
      id: 'figma',
      rect: FULL,
      stage: async () => {
        await press('1', ['meta'], 300);
        await openPalette();
        await type('Figma', 60);
        await wait(300);
        await click('.c-palette__item', t('figma.connectAction'));
        await wait(1200);
      },
      after: () => press('Escape', [], 500),
    },
    {
      // Designer compare (T62): Figma switched on through settings (saved: the demo HOME is throwaway), a local
      // "design" page standing in for the Figma frame (no Figma login in the demo). Side by side, then the overlay
      // captures both and switches to Difference.
      id: 'designer',
      rect: FULL,
      ms: 5000,
      stage: async () => {
        await press('1', ['meta'], 300);
        await openPalette();
        await type('Figma', 60);
        await wait(300);
        await click('.c-palette__item', t('figma.connectAction'));
        await wait(800);
        await click('.c-dialog[open] button[type="submit"]');
        await waitFor(`!document.querySelector('.c-dialog[open]')`);
        await press('P', ['meta', 'shift'], 300);
        await waitFor(`!!document.querySelector('.c-preview .c-panel__head .c-row__meta')`);
        await click('.c-preview .c-btn', t('preview.designer'));
        await waitFor(`!!document.querySelector('.c-preview__figma-bar .c-input')`);
        // Select what's there (a remembered address) so the typed one replaces it.
        await js(`(() => { const el = document.querySelector('.c-preview__figma-bar .c-input'); el?.focus(); el?.select(); })()`);
        await type(`${DESIGN_URL}design.html`, 10);
        await press('Enter', [], 300);
        await click('.c-preview__figma-bar .c-segment__item', t('preview.compare.side'));
        await wait(1800);
      },
      act: async () => {
        await wait(900);
        await click('.c-preview__figma-bar .c-segment__item', t('preview.compare.overlay'));
        await waitFor(`!!document.querySelector('.c-preview__shot')`);
        await wait(1300);
        await click('.c-preview__compare-bar .c-btn', t('preview.compare.diff'));
        await wait(1300);
      },
      after: async () => {
        await click('.c-preview__compare-bar .c-btn', t('preview.compare.diff'));
        await click('.c-preview__figma-bar .c-segment__item', t('preview.compare.stacked'));
        await click('.c-preview .c-btn', t('preview.designer'));
        await press('P', ['meta', 'shift'], 400);
      },
    },
    {
      // Remote servers (T56): ⌘K "Add remote server…", a host typed in. No host in the demo HOME, so no check runs.
      id: 'remote',
      rect: FULL,
      stage: async () => {
        await openPalette();
        await type(lang === 'ko' ? '원격' : 'remote', 60);
        await wait(300);
        await click('.c-palette__item', t('remote.addAction'));
        await wait(600);
        await type('devbox', 50);
        await wait(500);
      },
      after: () => press('Escape', [], 500),
    },
    {
      id: 'worktree',
      rect: FULL,
      ms: 5000,
      act: async () => {
        await wait(300);
        await openPalette();
        await type(lang === 'ko' ? '워크트리' : 'worktree', lang === 'ko' ? 120 : 60);
        await wait(300);
        await click('.c-palette__item', t('worktree.title'));
        await wait(700);
        await type('feat/coupon', 50);
        await wait(300);
        await click('.c-dialog[open] button', t('worktree.open'));
        await wait(1500);
      },
    },
    {
      // Session history (T11): demo transcripts in the throwaway HOME (capture.sh), search narrows the list.
      id: 'history',
      rect: FULL,
      ms: 4500,
      act: async () => {
        await wait(400);
        await press('Y', ['meta'], 1400);
        await type(lang === 'ko' ? '쿠폰' : 'coupon', lang === 'ko' ? 160 : 90);
        await wait(1200);
      },
      after: () => press('Escape', [], 400),
    },
    {
      // Commands timeline (T59): the coupon session's Bash calls (capture.sh) in its history detail.
      id: 'commands',
      rect: FULL,
      stage: async () => {
        await press('Y', ['meta'], 900);
        const title = lang === 'ko' ? '쿠폰 할인' : 'Coupon discount';
        // The list and then the session's commands load from disk: wait for each instead of a fixed pause.
        const item = `[...document.querySelectorAll('.c-modal[open] .c-modal__item')].find((e) => e.textContent.includes(${JSON.stringify(title)}))`;
        await waitFor(`!!${item}`);
        await js(`${item}.click()`);
        await waitFor(`!!document.querySelector('.c-modal[open] .c-commands')`, 15_000);
        await js(`document.querySelector('.c-modal[open] .c-commands')?.scrollIntoView({ block: 'center' })`);
        await wait(500);
      },
      after: () => press('Escape', [], 400),
    },
    {
      // AI trends (T35, T46, T63): the footer's news-icon button fetches the fixture feeds on open; the CLI tab, then the
      // Industry tab and its Korea side.
      id: 'trends',
      rect: FULL,
      ms: 6000,
      act: async () => {
        await wait(400);
        await click('.c-sidebar__foot .c-btn--icon');
        await waitFor(`!!document.querySelector('.c-modal[open] .c-modal__bullets li')`);
        await wait(1200);
        await js(
          `[...document.querySelectorAll('.c-modal[open] .c-modal__item')].find((e) => e.textContent.trim().startsWith('2.1.328'))?.click()`,
        );
        await wait(1000);
        await click('.c-modal[open] .c-segment__item', t('trends.tab.industry'));
        await wait(1400);
        await click('.c-modal[open] .c-segment__item', t('trends.region.kr'));
        await wait(1400);
      },
      after: () => press('Escape', [], 400),
    },
    {
      // Notes graph (T66): the smoke's three fixture folders as sources, ⌘⇧N, one note selected, its neighbours lit.
      // Graph (T73): the demo repos' notes with no setup, as groups; two repos picked together → their
      // `requirements` merge → a folder → its dots.
      id: 'graph',
      rect: FULL,
      ms: 6500,
      poster: 'first', // the groups are what the still should show
      stage: async () => {
        await js(`(() => {
          localStorage.setItem('aquila.graph.mode', 'map');
          localStorage.setItem('aquila.graph.project', '*');
          localStorage.setItem('aquila.graph.hintSeen.v2', '1');
        })()`);
        await press('N', ['meta', 'shift'], 400);
        await waitFor(`document.querySelectorAll('.c-kgroups__bubble').length > 3`, 20_000);
        await wait(600);
      },
      act: async () => {
        const bubble = (name: string, meta: boolean) =>
          js<boolean>(`(() => {
            const b = [...document.querySelectorAll('.c-kgroups__bubble')]
              .find((g) => g.querySelector('.c-kgroups__label')?.textContent === ${JSON.stringify(name)});
            b?.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: ${meta} }));
            return !!b;
          })()`);
        await wait(700);
        if (!(await bubble('web-shop', true))) throw new Error('graph: no web-shop group');
        await wait(500);
        if (!(await bubble('api-server', true))) throw new Error('graph: no api-server group');
        await wait(700);
        await click('.c-panel__bar button', t('graph.groups.together', { n: '2' }));
        await wait(1200);
        await bubble('requirements', false);
        await wait(1800);
      },
      after: async () => {
        await press('N', ['meta', 'shift'], 400);
        await js(`['mode', 'project'].forEach((k) => localStorage.removeItem('aquila.graph.' + k))`);
      },
    },
    { id: 'restore', rect: FULL },
    { id: 'power', rect: TOP_LEFT },
    {
      id: 'language',
      rect: FULL,
      poster: 'first', // the last frame is in the other language
      ms: 3200,
      // The ⚙ menu is native (not in the page's pixels): switch through the palette instead.
      act: async () => {
        await wait(700);
        await press('K', ['meta'], 500);
        await click('.c-palette__item', t('palette.switchLanguage'));
        await wait(1800);
      },
      after: async () => {
        await press('K', ['meta'], 500);
        await click('.c-palette__item', translator(lang === 'ko' ? 'en' : 'ko')('palette.switchLanguage'));
        await wait(800);
      },
    },
  ];

  const grab = async (rect: Rectangle) =>
    (await retryViz(async () => withViews(await win.webContents.capturePage(rect), rect, previews?.visible() ?? [])))
      .resize({ ...OUT, quality: 'best' })
      .toPNG();

  const record = async (rect: Rectangle, ms: number, act: () => Promise<void>): Promise<Frame[]> => {
    const frames: Frame[] = [];
    const start = Date.now();
    let running = true;
    const loop = (async () => {
      while (running) {
        const t = Date.now() - start;
        frames.push({ t, png: await grab(rect) });
        await wait(Math.max(0, start + (frames.length * 1000) / FPS - Date.now()));
      }
    })();
    try {
      await act();
      await wait(Math.max(0, ms - (Date.now() - start)));
    } finally {
      running = false;
      await loop;
    }
    return frames;
  };

  const encoder = new BrowserWindow({
    show: false,
    ...OUT,
    webPreferences: { backgroundThrottling: false, offscreen: false },
  });
  await encoder.loadURL('about:blank');

  const write = (file: string, data: Buffer, limit: number) => {
    if (data.length > limit) throw new Error(`${file} is ${data.length} bytes, over the ${limit} budget`);
    fs.writeFileSync(path.join(outDir, file), data);
    console.log(`[capture] ${file} ${(data.length / 1024).toFixed(0)} KB`);
  };

  try {
    win.setContentSize(WIN.width, WIN.height);
    win.center();
    win.show();
    win.focus();
    await wait(1000);
    // CAPTURE_ONLY=history,changes: every scenario still runs (later ones build on earlier state), only those are written.
    const only = process.env.CAPTURE_ONLY?.split(',').filter(Boolean);
    for (const s of scenarios) {
      if (only && !only.includes(s.id)) {
        await s.stage?.();
        await s.act?.();
        await s.after?.();
        continue;
      }
      await s.stage?.();
      const base = `${s.id}.${lang}`;
      if (!s.act) {
        const still = await encodeStill(encoder, await grab(s.rect));
        write(`${base}.webp`, still, CAPTURE_BUDGET.maxStillBytes);
        fs.rmSync(path.join(outDir, `${base}.webm`), { force: true }); // was a loop before
      } else {
        const ms = Math.min(s.ms ?? 4000, CAPTURE_BUDGET.maxClipMs);
        const frames = await record(s.rect, ms, s.act);
        const video = await encodeClip(encoder, frames);
        const poster = await encodeStill(
          encoder,
          (s.poster === 'first' ? frames[0] : frames[frames.length - 1]).png,
        );
        write(`${base}.webm`, video, CAPTURE_BUDGET.maxVideoBytes);
        write(`${base}.webp`, poster, CAPTURE_BUDGET.maxStillBytes);
        console.log(`[capture] ${s.id}: ${frames.length} frames in ${ms} ms`);
      }
      await s.after?.();
    }
  } catch (err) {
    return fail((err as Error).stack ?? String(err));
  } finally {
    encoder.destroy();
  }
  console.log(`[capture] OK (${lang}): ${scenarios.length} items → ${outDir}`);
  void sessions.killAll().finally(() => app.exit(0));
}

/**
 * Chromium's compositor sometimes rejects a `capturePage` with "UnknownVizError" (seen on the preview's native view):
 * try again a few times before failing the whole run.
 */
async function retryViz<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= tries || !String(err).includes('UnknownVizError')) throw err;
      console.log(`[capture] capturePage: UnknownVizError, retry ${i}/${tries - 1}`);
      await wait(150 * i);
    }
  }
}

/**
 * Native preview views (T33) aren't part of the page `capturePage` sees: copy their pixels in at their bounds.
 * Same display, so both images share one scale factor.
 */
export async function withViews(
  base: NativeImage,
  rect: Rectangle,
  views: { bounds: Rectangle; capture: () => Promise<NativeImage> }[],
): Promise<NativeImage> {
  if (!views.length) return base;
  // capturePage images are in device pixels: the scale is pixels per DIP of what was captured.
  const out = Buffer.from(base.toBitmap());
  const { width: w, height: h } = base.getSize();
  const sf = w / rect.width;
  for (const v of views) {
    const img = await v.capture();
    const px = img.toBitmap();
    const { width: vw, height: vh } = img.getSize();
    if (Math.abs(vw / v.bounds.width - sf) > 0.05) continue;
    const ox = Math.round((v.bounds.x - rect.x) * sf);
    const oy = Math.round((v.bounds.y - rect.y) * sf);
    const x0 = Math.max(0, ox);
    const x1 = Math.min(w, ox + vw);
    if (x1 <= x0) continue;
    for (let row = 0; row < vh; row++) {
      const y = oy + row;
      if (y < 0 || y >= h) continue;
      px.copy(out, (y * w + x0) * 4, (row * vw + (x0 - ox)) * 4, (row * vw + (x1 - ox)) * 4);
    }
  }
  return nativeImage.createFromBitmap(out, { width: w, height: h });
}

/** PNG → WebP via the encoder window's canvas. */
async function encodeStill(encoder: BrowserWindow, png: Buffer): Promise<Buffer> {
  const b64: string = await encoder.webContents.executeJavaScript(`(async () => {
    const img = await createImageBitmap(await (await fetch('data:image/png;base64,${png.toString('base64')}')).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext('2d').drawImage(img, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/webp', quality: 0.75 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  })()`);
  return Buffer.from(b64, 'base64');
}

/**
 * Frames → VP9 WebM, replayed in real time with their capture timing (MediaRecorder stamps frames by wall clock).
 */
async function encodeClip(encoder: BrowserWindow, frames: Frame[]): Promise<Buffer> {
  if (frames.length < 2) throw new Error('too few frames');
  const payload = JSON.stringify(
    frames.map((f) => ({ t: f.t, src: `data:image/png;base64,${f.png.toString('base64')}` })),
  );
  const b64: string = await encoder.webContents.executeJavaScript(`(async () => {
    const frames = ${payload};
    const imgs = await Promise.all(frames.map(async (f) => createImageBitmap(await (await fetch(f.src)).blob())));
    const c = document.createElement('canvas');
    c.width = ${OUT.width};
    c.height = ${OUT.height};
    const g = c.getContext('2d');
    const track = c.captureStream(0).getVideoTracks()[0];
    const rec = new MediaRecorder(new MediaStream([track]), {
      mimeType: 'video/webm;codecs=vp9',
      videoBitsPerSecond: ${VIDEO_KBPS * 1000},
    });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    const sleepUntil = (at) => new Promise((r) => setTimeout(r, Math.max(0, at - performance.now())));
    g.drawImage(imgs[0], 0, 0);
    rec.start();
    track.requestFrame();
    const t0 = performance.now();
    for (let i = 1; i < imgs.length; i++) {
      await sleepUntil(t0 + frames[i].t - frames[0].t);
      g.drawImage(imgs[i], 0, 0);
      track.requestFrame();
    }
    await sleepUntil(performance.now() + ${Math.round(1000 / FPS)});
    track.requestFrame();
    rec.stop();
    await stopped;
    const b64 = async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    return b64(new Blob(chunks, { type: 'video/webm' }));
  })()`);
  return Buffer.from(b64, 'base64');
}
