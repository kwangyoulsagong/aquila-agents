// `AQUILA_SMOKE_REAL=<dir>` with a hidden smoke run (`npm run build && AQUILA_SMOKE=1 AQUILA_HIDDEN=1
// AQUILA_SMOKE_REAL=<dir> npx electron .`): a local-only check against a real note folder. Point it at a COPY of your
// notes (it types into the largest note). Adds the folder as the only note source and times what a user waits for:
// the index, ⌘O, the explorer (expand the biggest folder, filter by an ID), the table view (open, sort, scroll), the
// graph panel (This week / Around this note), the largest note in the editor, per-key typing latency with the
// explorer and the graph open, reading mode; then 30 s idle with everything open (CPU per process, memory).
// Prints `[real] {...}` lines, screenshots to dist/real-*.png, console warnings / errors of the page. Exit 0 / 1.
// AQUILA_SMOKE_REAL_ID: the ID to filter the explorer and ⌘O by (default FE-REQ-030).
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Config } from '../src/shared/api/types';
import { translator } from '../src/shared/i18n/dictionary';
import type { NoteSmokeHelpers } from './notesSmoke';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEYS = 200;
const KEY_GAP_MS = 60;
const IDLE_MS = 30_000;
const VIEW = `document.querySelector('.c-editor .cm-content').cmTile.root.view`;

/** Notes under `dir` (skips dot folders, as the index does). */
function notesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return -1;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]! * 10) / 10;
};

export async function runRealCheck(
  win: BrowserWindow,
  config: Config,
  h: NoteSmokeHelpers,
  dir: string,
): Promise<void> {
  const t = translator(config.language);
  const outDir = path.join(app.getAppPath(), 'dist');
  fs.mkdirSync(outDir, { recursive: true });
  const id = process.env.AQUILA_SMOKE_REAL_ID || 'FE-REQ-030';
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const console_: { level: string; message: string; source: string }[] = [];
  win.webContents.on('console-message', (e) => {
    const ev = e as unknown as { level: string; message: string; sourceId: string; lineNumber: number };
    if (ev.level === 'warning' || ev.level === 'error')
      console_.push({
        level: ev.level,
        message: ev.message.slice(0, 400),
        source: `${ev.sourceId}:${ev.lineNumber}`,
      });
  });
  win.webContents.on('render-process-gone', (_e, d) =>
    console_.push({ level: 'crash', message: d.reason, source: '' }),
  );
  const result: Record<string, unknown> = {};
  const problems: string[] = [];
  const shots: string[] = [];
  const shot = async (name: string) => {
    await wait(300);
    const out = path.join(outDir, `real-${name}.png`);
    fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
    shots.push(out);
  };
  const dbg = win.webContents.debugger;
  const cdp = (method: string, params: object = {}) => {
    if (!dbg.isAttached()) dbg.attach('1.3');
    return dbg.sendCommand(method, params);
  };
  /** Waits (checked every frame) until `cond` holds; resolves with the ms since `t0` (renderer clock) or -1. */
  const until = (cond: string, t0 = 'performance.now()', ms = 20_000) =>
    js<number>(`new Promise((res) => {
      const t0 = ${t0};
      const end = performance.now() + ${ms};
      const check = () => {
        let ok = false;
        try { ok = !!(${cond}); } catch {}
        if (ok) return res(Math.round(performance.now() - t0));
        if (performance.now() > end) return res(-1);
        requestAnimationFrame(check);
      };
      check();
    })`);
  /** Runs `trigger` (page JS) and times it until `cond`, both in the page: no IPC in the number. */
  const timedJs = (trigger: string, cond: string, ms?: number) =>
    until(cond, `(() => { const t = performance.now(); ${trigger}; return t; })()`, ms);
  /** Times a main-side trigger (input events) from just before it until `cond`. */
  const timedInput = async (trigger: () => void, cond: string, ms?: number) => {
    await js(`window.__t0 = performance.now()`);
    trigger();
    return until(cond, 'window.__t0', ms);
  };
  const setInput = (sel: string, value: string, proto = 'HTMLInputElement') => `(() => {
    const input = ${sel};
    input.focus();
    const set = Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set;
    set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event(${proto === 'HTMLSelectElement' ? "'change'" : "'input'"}, { bubbles: true }));
  })()`;
  const noteAside = `aside[aria-label=${JSON.stringify(t('note.title'))}]`;
  const graphAside = `aside[aria-label=${JSON.stringify(t('graph.title'))}]`;
  const ROW = (rel: string) =>
    `[...document.querySelectorAll('.c-explorer .c-tree__row')].filter((r) => r.dataset.rel === ${JSON.stringify(rel)}).pop()`;
  const step = (name: string, value: unknown) => {
    result[name] = value;
    console.log(`[real] ${name} ${JSON.stringify(value)}`);
  };

  try {
    await wait(1500);
    await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    const all = notesUnder(dir);
    const biggest = all.reduce((a, b) => (fs.statSync(a).size >= fs.statSync(b).size ? a : b));
    const folders = new Map<string, number>();
    for (const n of all) {
      const rel = path.relative(dir, path.dirname(n));
      folders.set(rel, (folders.get(rel) ?? 0) + 1);
    }
    const bigFolder = [...folders].sort((a, b) => b[1] - a[1])[0]![0];
    step('corpus', {
      notes: all.length,
      biggestKB: Math.round(fs.statSync(biggest).size / 1024),
      bigFolderNotes: folders.get(bigFolder),
    });

    // Index.
    const i0 = Date.now();
    const st = await js<{ sources: { id: string; path: string }[] }>(
      `window.aquila.graphAddSource(${JSON.stringify(dir)})`,
    );
    const sourceId =
      st.sources.find((s) => s.path === dir || path.resolve(s.path) === path.resolve(dir))?.id ?? '';
    let indexed = 0;
    for (let i = 0; i < 1200; i++) {
      const s = await js<{ state: string; notes: number } | undefined>(
        `window.aquila.graphStatus().then((s) => s.sources.find((x) => x.id === ${JSON.stringify(sourceId)}))`,
      );
      if (s?.state === 'ready') {
        indexed = s.notes;
        break;
      }
      await wait(100);
    }
    step('index', { ms: Date.now() - i0, notes: indexed });
    if (!indexed) problems.push('index never became ready');
    await wait(2000);

    // What the first opens wait for (main + IPC, from the page): ⌘O's notes, the explorer's listing, the table's rows.
    const ipc = await js<Record<string, number[]>>(`(async () => {
      const time = async (f) => { const out = []; for (let i = 0; i < 2; i++) { const t = performance.now(); await f(); out.push(Math.round(performance.now() - t)); } return out; };
      const id = ${JSON.stringify(sourceId)};
      return {
        notesOnlySnapshot: await time(() => window.aquila.graphSnapshot({ notesOnly: true })),
        noteFsList: await time(() => window.aquila.noteFsList(id, {})),
        noteTable: await time(() => window.aquila.noteTable(id)),
      };
    })()`);
    step('ipc', ipc);

    // ⌘O: first open → list shown; filter → results.
    const paletteOpen = await timedInput(
      () => h.press(win, 'O', ['meta']),
      `document.querySelectorAll('.c-palette[open] .c-palette__item').length > 0`,
    );
    const items = await js<number>(`document.querySelectorAll('.c-palette[open] .c-palette__item').length`);
    const filterMs = await timedJs(
      setInput(`document.querySelector('.c-palette[open] input')`, id),
      `[...document.querySelectorAll('.c-palette[open] .c-palette__item')].slice(0, 3).some((x) => x.textContent.includes(${JSON.stringify(id)}))`,
    );
    // Per character, as typed (each keystroke a new filter over all notes).
    await js(setInput(`document.querySelector('.c-palette[open] input')`, ''));
    await wait(300);
    const perChar: number[] = [];
    for (const ch of 'coach') {
      await js(`window.__t0 = performance.now()`);
      win.webContents.insertText(ch);
      // Two frames after the input: React committed the filtered list.
      perChar.push(
        await js<number>(
          `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(Math.round(performance.now() - window.__t0)))))`,
        ),
      );
      await wait(120);
    }
    await shot('palette');
    step('palette', { openMs: paletteOpen, items, filterMs, perCharFrameMs: perChar });
    h.press(win, 'Escape', []);
    await wait(400);
    // Again, warm (code loaded, notes listed once): what is left is the palette's own work.
    const paletteAgain = await timedInput(
      () => h.press(win, 'O', ['meta']),
      `document.querySelectorAll('.c-palette[open] .c-palette__item').length > 0`,
    );
    step('paletteAgain', { openMs: paletteAgain });
    h.press(win, 'Escape', []);
    await wait(400);

    // Explorer: ⌘⇧O (no note open) → tree.
    const explorerMs = await timedInput(
      () => h.press(win, 'O', ['meta', 'shift']),
      `document.querySelectorAll('${noteAside} .c-explorer .c-tree__row').length > 0`,
    );
    const sourceSelect = `document.querySelector('.c-explorer select[aria-label=${JSON.stringify(t('explorer.source'))}]')`;
    if (await js<boolean>(`!!${sourceSelect}`))
      await js(setInput(sourceSelect, sourceId, 'HTMLSelectElement'));
    await wait(500);
    const topRows = await js<string[]>(
      `[...document.querySelectorAll('.c-explorer .c-tree__row')].map((r) => r.dataset.rel)`,
    );
    // Expand the biggest folder, parent by parent (a compact chain row stands for several).
    const parts = bigFolder.split(path.sep);
    let expandMs = -1;
    for (let i = 1; i <= parts.length; i++) {
      const rel = parts.slice(0, i).join('/');
      if (!(await js<boolean>(`!!${ROW(rel)}`))) continue;
      const leaf = i === parts.length;
      const ms = await timedJs(
        `${ROW(rel)}.click()`,
        leaf
          ? `[...document.querySelectorAll('.c-explorer .c-tree__row')].some((r) => r.dataset.rel?.startsWith(${JSON.stringify(bigFolder + '/')}))`
          : `[...document.querySelectorAll('.c-explorer .c-tree__row')].some((r) => r.dataset.rel?.startsWith(${JSON.stringify(rel + '/')}))`,
        5000,
      );
      if (leaf) expandMs = ms;
    }
    const rowsShown = await js<number>(`document.querySelectorAll('.c-explorer .c-tree__row').length`);
    await shot('explorer-expanded');
    // Scroll the expanded tree: frames while it scrolls.
    const treeScroll = await js<{ maxGap: number; frames: number }>(`new Promise((res) => {
      const tree = document.querySelector('.c-explorer .c-tree');
      let last = performance.now(), maxGap = 0, frames = 0, n = 0;
      const tick = (t) => {
        maxGap = Math.max(maxGap, t - last); last = t; frames++;
        tree.scrollTop += 120;
        if (++n < 60) requestAnimationFrame(tick); else res({ maxGap: Math.round(maxGap), frames });
      };
      requestAnimationFrame(tick);
    })`);
    const filterInput = `document.querySelector('.c-explorer input[aria-label=${JSON.stringify(t('explorer.filter'))}]')`;
    const explorerFilterMs = await timedJs(
      setInput(filterInput, id),
      `(() => { const f = [...document.querySelectorAll('.c-explorer .c-tree__row[data-kind=file]')]; return f.length > 0 && f.every((r) => r.textContent.includes(${JSON.stringify(id)}) || r.dataset.rel.includes(${JSON.stringify(id)})); })()`,
    );
    const filterRows = await js<string[]>(
      `[...document.querySelectorAll('.c-explorer .c-tree__row[data-kind=file]')].map((r) => r.dataset.rel)`,
    );
    await shot('explorer-filter');
    await js(setInput(filterInput, ''));
    step('explorer', {
      openMs: explorerMs,
      topRows: topRows.length,
      expandMs,
      rowsShown,
      treeScroll,
      filterMs: explorerFilterMs,
      filterMatches: filterRows.length,
    });
    if (!filterRows.length) problems.push(`explorer filter "${id}" matched nothing`);

    // The largest note (through ⌘O by its file name), with the explorer open.
    const base = path.basename(biggest, '.md');
    h.press(win, 'O', ['meta']);
    await until(`!!document.querySelector('.c-palette[open] input')`);
    await js(setInput(`document.querySelector('.c-palette[open] input')`, base));
    await until(`[...document.querySelectorAll('.c-palette[open] .c-palette__item')].length > 0`);
    await wait(300);
    const openNoteMs = await timedInput(
      () => h.press(win, 'Enter', []),
      `document.querySelector('${noteAside} .c-panel__head > span')?.getAttribute('title')?.endsWith(${JSON.stringify(path.basename(biggest))}) && document.querySelectorAll('.c-editor .cm-line').length > 10`,
    );
    const lines = await js<number>(`${VIEW}.state.doc.lines`).catch(() => -1);
    await shot('editor-big');
    step('bigNote', { openMs: openNoteMs, lines });
    if (openNoteMs < 0) problems.push('the largest note did not open from ⌘O');

    // The snapshot every graph view starts from (main builds it, IPC copies it): cold, then warm.
    const snapshotMs = await js<number[]>(`(async () => {
      const out = [];
      for (let i = 0; i < 3; i++) { const t = performance.now(); const g = await window.aquila.graphSnapshot(); out.push(Math.round(performance.now() - t)); window.__snapSize = [g.nodes.length, g.edges.length]; }
      return out;
    })()`);
    step('snapshot', { ms: snapshotMs, size: await js<number[]>(`window.__snapSize`) });

    // Graph panel: This week, then Around this note.
    const segment = (label: string) =>
      `[...document.querySelectorAll('${graphAside} .c-segment__item')].find((b) => b.textContent === ${JSON.stringify(label)})`;
    const graphOpenMs = await timedInput(
      () => h.press(win, 'N', ['meta', 'shift']),
      `!!document.querySelector('${graphAside} .c-segment__item')`,
    );
    await js(`window.__graphSettled = null`);
    const weekMs = await timedJs(
      `${segment(t('graph.mode.week'))}.click()`,
      `document.querySelectorAll('${graphAside} .c-kweek__day').length > 0`,
    );
    const weekDays = await js<number>(`document.querySelectorAll('${graphAside} .c-kweek__day').length`);
    await shot('graph-week');
    const focusMs = await timedJs(
      `window.__graphSettled = null; ${segment(t('graph.mode.focusNote'))}.click()`,
      `window.__graphSettled?.via === 'focus'`,
    );
    const focusInfo = await js<unknown>(`window.__graphSettled`);
    await shot('graph-focus');
    h.press(win, 'N', ['meta', 'shift']);
    await until(`!document.querySelector('${graphAside}')`);
    await wait(500);
    await js(`window.__graphSettled = null`);
    const graphAgainMs = await timedInput(
      () => h.press(win, 'N', ['meta', 'shift']),
      `!!document.querySelector('${graphAside} .c-segment__item') && window.__graphSettled?.via === 'focus'`,
    );
    step('graph', {
      againMs: graphAgainMs,
      openMs: graphOpenMs,
      weekMs,
      weekDays,
      focusMs,
      focus: focusInfo,
    });

    // Typing 200 characters into the largest note (explorer + graph open): per key, keydown → CodeMirror's update
    // (its synchronous DOM work) → the next frame.
    await js(`(() => {
      const v = ${VIEW};
      const at = v.state.doc.line(Math.min(40, v.state.doc.lines)).to;
      v.focus();
      v.dispatch({ selection: { anchor: at }, scrollIntoView: true });
      window.__keys = [];
      window.__long = [];
      const orig = v.update.bind(v);
      window.__pending = null;
      v.update = (trs) => {
        const s = performance.now();
        orig(trs);
        const p = window.__pending;
        if (p && trs.some((tr) => tr.docChanged)) {
          window.__pending = null;
          const u = performance.now();
          requestAnimationFrame(() => {
            const f = performance.now();
            setTimeout(() => window.__keys.push({ update: u - s, dom: u - p, frame: f - p, after: performance.now() - p }), 0);
          });
        }
      };
      window.__unpatch = () => { delete v.update; };
      v.contentDOM.addEventListener('keydown', (e) => { window.__pending = e.timeStamp; }, true);
      try {
        const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); });
        po.observe({ type: 'longtask' });
        window.__po = po;
      } catch {}
    })()`);
    const text = 'the quick brown fox jumps over the lazy dog ';
    for (let i = 0; i < KEYS; i++) {
      const ch = text[i % text.length]!;
      const keyCode = ch === ' ' ? 'Space' : ch;
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      await wait(KEY_GAP_MS);
    }
    await wait(500);
    const keys = await js<{ update: number; dom: number; frame: number; after: number }[]>(`window.__keys`);
    const longTasks = await js<number[]>(`(window.__po?.disconnect(), window.__unpatch(), window.__long)`);
    const typed = await js<boolean>(`${VIEW}.state.doc.toString().includes(${JSON.stringify(text.trim())})`);
    const typing = {
      keys: keys.length,
      typedOk: typed,
      updateMs: {
        p95: pct(
          keys.map((k) => k.update),
          95,
        ),
        max: pct(
          keys.map((k) => k.update),
          100,
        ),
      },
      keyToDomMs: {
        p50: pct(
          keys.map((k) => k.dom),
          50,
        ),
        p95: pct(
          keys.map((k) => k.dom),
          95,
        ),
        max: pct(
          keys.map((k) => k.dom),
          100,
        ),
      },
      keyToFrameMs: {
        p50: pct(
          keys.map((k) => k.frame),
          50,
        ),
        p95: pct(
          keys.map((k) => k.frame),
          95,
        ),
        max: pct(
          keys.map((k) => k.frame),
          100,
        ),
      },
      longTasks,
    };
    step('typing', typing);
    if (!typed) problems.push('typed text is not in the document');
    await shot('typing');

    // Reading mode toggle.
    await js(`${VIEW}.focus()`);
    const readingMs = await timedInput(
      () => h.press(win, 'E', ['meta']),
      `!!document.querySelector('.c-editor .cm-reading')`,
      5000,
    );
    await shot('reading');
    await js(`${VIEW}.focus()`);
    const editingMs = await timedInput(
      () => h.press(win, 'E', ['meta']),
      `!document.querySelector('.c-editor .cm-reading')`,
      5000,
    );
    step('reading', { onMs: readingMs, offMs: editingMs });

    // Idle 30 s with the explorer, the big note and the graph open.
    await js(`document.activeElement?.blur?.()`);
    await wait(2000);
    app.getAppMetrics();
    await wait(IDLE_MS);
    const metrics = app.getAppMetrics();
    const cpu: Record<string, number> = {};
    let rendererMB = 0;
    let wakeups = 0;
    for (const m of metrics) {
      cpu[m.type] = Math.round(((cpu[m.type] ?? 0) + m.cpu.percentCPUUsage) * 10) / 10;
      wakeups += m.cpu.idleWakeupsPerSecond;
      if (m.type === 'Tab') rendererMB += m.memory.workingSetSize / 1024;
    }
    const heap = (await cdp('Runtime.getHeapUsage')) as { usedSize: number };
    step('idle', {
      cpu,
      cpuTotal: Math.round(Object.values(cpu).reduce((a, b) => a + b, 0) * 10) / 10,
      wakeupsPerSec: Math.round(wakeups),
      rendererMB: Math.round(rendererMB),
      heapMB: Math.round(heap.usedSize / 1048576),
    });
    await shot('idle-all');

    // Table view (a dialog): open with all rows, sort by a column, scroll the virtual grid.
    h.press(win, 'N', ['meta', 'shift']); // the graph closes first (the dialog covers it anyway)
    await wait(500);
    const tableClick = await h.paletteRun(win, t('table.menu'));
    const tableMs = tableClick
      ? await until(`document.querySelectorAll('.c-ntable .c-ntable__row').length > 0`, `performance.now()`)
      : -1;
    // The palette clicked inside its own JS: measured from there is close enough (a frame).
    const tableInfo = await js<{ rows: number; height: number; cols: string[] }>(`(() => {
      const b = document.querySelector('.c-ntable__body');
      return { rows: document.querySelectorAll('.c-ntable .c-ntable__row').length, height: b ? b.offsetHeight : 0, cols: [...document.querySelectorAll('.c-ntable__th')].map((x) => x.textContent) };
    })()`);
    const tableSrc = `document.querySelector('.c-dialog[open] select[aria-label=${JSON.stringify(t('table.source'))}]')`;
    if (await js<boolean>(`!!${tableSrc}`)) await js(setInput(tableSrc, sourceId, 'HTMLSelectElement'));
    await shot('table');
    const firstRow = `document.querySelector('.c-ntable .c-ntable__row')?.textContent`;
    const before = await js<string>(firstRow);
    const sortMs = await timedJs(
      `document.querySelectorAll('.c-ntable__th')[0].querySelector('.c-ntable__sort').click()`,
      `document.querySelector('.c-ntable .c-ntable__row')?.textContent !== ${JSON.stringify(before)}`,
      5000,
    );
    const sortMs2 = await timedJs(
      `document.querySelectorAll('.c-ntable__th')[Math.min(1, document.querySelectorAll('.c-ntable__th').length - 1)].querySelector('.c-ntable__sort').click()`,
      `true`,
      5000,
    );
    const gridScroll = await js<{ maxGap: number; frames: number; blank: number }>(`new Promise((res) => {
      const g = document.querySelector('.c-ntable');
      let last = performance.now(), maxGap = 0, frames = 0, n = 0, blank = 0;
      const tick = (t) => {
        maxGap = Math.max(maxGap, t - last); last = t; frames++;
        if (!document.querySelectorAll('.c-ntable .c-ntable__row').length) blank++;
        g.scrollTop += 300;
        if (++n < 90) requestAnimationFrame(tick); else res({ maxGap: Math.round(maxGap), frames, blank, top: g.scrollTop });
      };
      requestAnimationFrame(tick);
    })`);
    await shot('table-scrolled');
    step('table', { openMs: tableMs, ...tableInfo, sortMs, sortSecondColMs: sortMs2, gridScroll });
    h.press(win, 'Escape', []);
    await wait(500);

    step('console', console_.slice(0, 40));
    step('screenshots', shots);
    if (console_.some((c) => c.level === 'error' || c.level === 'crash')) problems.push('console errors');
    console.log(`[real] ${problems.length ? `PROBLEMS: ${problems.join('; ')}` : 'OK'}`);
    if (sourceId)
      await js(`window.aquila.graphRemoveSource(${JSON.stringify(sourceId)})`).catch(() => undefined);
    app.exit(problems.length ? 1 : 0);
  } catch (e) {
    console.error(`[real] FAIL: ${(e as Error).stack ?? e}`);
    console.log(`[real] console ${JSON.stringify(console_.slice(0, 40))}`);
    app.exit(1);
  }
}
