// `npm run perf`: 15 real shell sessions opened from the UI (2 on screen in a split, 13 hidden), measured idle and
// while every session streams agent-like output. Prints one JSON line `[perf] {...}` and exits 0.
// Numbers: CPU % per process type (app.getAppMetrics), renderer memory, session:data messages/s reaching the
// renderer, and renderer frames (fps, longest gap) — the "does it stay smooth" part.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { SessionManager } from './sessions';

const SESSIONS = 15;
const MEASURE_MS = 10000;
const FLOOD_MS = 5000;
const FLOOD_MARKER = 'AQUILA_FLOOD_2';
/** ~50 lines/s of ~60 bytes per session: roughly a streaming agent. */
const STREAM =
  'while :; do printf \'%s step %05d working on src/some/file.ts ........\\n\' "$(date +%T)" $RANDOM; sleep 0.02; done\r';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function press(win: BrowserWindow, keyCode: string, modifiers: Electron.InputEvent['modifiers']) {
  for (const type of ['keyDown', 'keyUp'] as const)
    win.webContents.sendInputEvent({ type, keyCode, modifiers });
}

async function measure(win: BrowserWindow, ms = MEASURE_MS) {
  // Renderer side: count session:data messages and frames while we wait.
  await win.webContents.executeJavaScript(`(() => {
    window.__perf = { msgs: 0, frames: 0, maxGap: 0, last: performance.now(), on: true };
    window.__perfOff?.();
    window.__perfOff = window.aquila.onData(() => window.__perf.msgs++);
    const tick = (t) => {
      const p = window.__perf;
      if (!p.on) return;
      p.frames++; p.maxGap = Math.max(p.maxGap, t - p.last); p.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  })()`);
  app.getAppMetrics(); // resets the CPU window
  await wait(ms);
  const metrics = app.getAppMetrics();
  const r = await win.webContents.executeJavaScript(
    `(() => { const p = window.__perf; p.on = false; window.__perfOff(); return p; })()`,
  );
  const cpu: Record<string, number> = {};
  let rendererMB = 0;
  let totalMB = 0;
  let wakeups = 0;
  for (const m of metrics) {
    wakeups += m.cpu.idleWakeupsPerSecond;
    cpu[m.type] = Math.round(((cpu[m.type] ?? 0) + m.cpu.percentCPUUsage) * 10) / 10;
    totalMB += m.memory.workingSetSize / 1024;
    if (m.type === 'Tab') rendererMB += m.memory.workingSetSize / 1024;
  }
  const secs = ms / 1000;
  return {
    cpu,
    cpuTotal: Math.round(Object.values(cpu).reduce((a, b) => a + b, 0) * 10) / 10,
    rendererMB: Math.round(rendererMB),
    totalMB: Math.round(totalMB),
    /** Idle wakeups/s summed over all app processes (T9). */
    wakeupsPerSec: Math.round(wakeups),
    msgsPerSec: Math.round(r.msgs / secs),
    fps: Math.round(r.frames / secs),
    maxFrameGapMs: Math.round(r.maxGap),
  };
}

export async function runPerf(win: BrowserWindow, sessions: SessionManager) {
  const ids: string[] = [];
  // UI-opened sessions go through the IPC handler's `s.create(...)`: note their ids.
  const create = sessions.create.bind(sessions);
  sessions.create = (...args: Parameters<SessionManager['create']>) => {
    const info = create(...args);
    ids.push(info.id);
    return info;
  };

  await wait(1500);
  for (let i = 0; i < SESSIONS - 1; i++) {
    press(win, 'T', ['meta', 'alt']);
    await wait(300);
  }
  press(win, 'D', ['meta']);
  await wait(300);
  press(win, 'T', ['meta', 'alt']);
  await wait(4000); // shells start (rc files)
  if (ids.length !== SESSIONS) {
    console.error(`[perf] FAIL: opened ${ids.length} sessions, wanted ${SESSIONS}`);
    return app.exit(1);
  }
  const visible = await win.webContents.executeJavaScript(
    `document.querySelectorAll('.term-host:not([hidden])').length`,
  );

  const idle = await measure(win);
  for (const id of ids) sessions.write(id, STREAM);
  await wait(2000);
  const streaming = await measure(win);
  for (const id of ids) sessions.write(id, '\x03');
  await wait(1000);

  // Flood: `yes` in a session on screen. Smooth = frames keep coming; responsive = Ctrl+C answers fast.
  const flooded = ids[ids.length - 1]!;
  sessions.write(flooded, 'yes\r');
  await wait(1000);
  const flood = await measure(win, FLOOD_MS);
  await win.webContents.executeJavaScript(`(() => {
    window.__ctrlc = 0;
    const off = window.aquila.onData(({ data }) => {
      if (data.includes('${FLOOD_MARKER}')) { window.__ctrlc = performance.now(); off(); }
    });
    window.__ctrlcStart = performance.now();
  })()`);
  sessions.write(flooded, '\x03');
  sessions.write(flooded, 'echo AQUILA_FLOOD_$((1+1))\r');
  let ctrlCMs = -1;
  for (let i = 0; i < 100 && ctrlCMs < 0; i++) {
    await wait(100);
    ctrlCMs = await win.webContents.executeJavaScript(
      `window.__ctrlc ? Math.round(window.__ctrlc - window.__ctrlcStart) : -1`,
    );
  }

  const graph = await measureGraph(win);

  console.log(
    `[perf] ${JSON.stringify({ sessions: ids.length, visible, idle, streaming, flood: { ...flood, ctrlCMs }, graph })}`,
  );
  void sessions.killAll().finally(() => app.exit(0));
}

const GRAPH_NOTES = 2000;

/** 2,000 generated notes: a written link or two each, a tag of 20, a shared ID of 300, a mention of another title. */
function writeNotes(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < GRAPH_NOTES; i++) {
    const link = (i * 7 + 3) % GRAPH_NOTES;
    const body = [
      `# Note ${String(i).padStart(4, '0')} about topic${i % 50}`,
      '',
      `Follows [[Note ${String(link).padStart(4, '0')} about topic${link % 50}]] and touches DB-${i % 300}.`,
      i % 3 === 0
        ? `See also [[Note ${String((i + 1) % GRAPH_NOTES).padStart(4, '0')} about topic${(i + 1) % 50}]].`
        : '',
      '',
      `#group${i % 20}`,
    ].join('\n');
    fs.writeFileSync(path.join(dir, `note-${i}.md`), body);
  }
}

const APP_SESSIONS = 300;
const APP_FILES = 20;

/**
 * T70: Claude transcripts in the perf run's graph folder (read like history in smoke / perf): each got one of the
 * notes as `@path` and edited files in five areas.
 */
function writeTranscripts(dir: string, notesDir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  const at = new Date().toISOString();
  for (let i = 0; i < APP_SESSIONS; i++) {
    const cwd = path.join(os.tmpdir(), 'aquila-perf-repo');
    const line = (type: string, content: unknown) =>
      JSON.stringify({ type, cwd, timestamp: at, message: { content } });
    const edits = Array.from({ length: APP_FILES }, (_, k) => ({
      type: 'tool_use',
      id: `e${k}`,
      name: 'Edit',
      input: { file_path: path.join(cwd, 'src', `area${k % 5}`, `file${(i * 3 + k) % 400}.ts`) },
    }));
    fs.writeFileSync(
      path.join(dir, `perf-${i}.jsonl`),
      [
        line('user', `Session ${i}\n\n@${path.join(notesDir, `note-${(i * 13) % GRAPH_NOTES}.md`)}`),
        line('assistant', edits),
      ].join('\n'),
    );
  }
}

/** Main-process memory (MB): the graph index worker is a thread of it. */
const browserMB = () =>
  Math.round(
    app
      .getAppMetrics()
      .filter((m) => m.type === 'Browser')
      .reduce((a, m) => a + m.memory.workingSetSize, 0) / 1024,
  );

/**
 * Knowledge graph budget (T63–T71): index 2,000 notes, then idle with the graph closed, open (layout until settled,
 * then idle), wheel-zoom it, and closed again. Main memory before / after indexing, layout time, frames while zooming.
 */
async function measureGraph(win: BrowserWindow) {
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const dir = path.join(os.tmpdir(), `aquila-perf-notes-${process.pid}`);
  writeNotes(dir);
  const mainBefore = browserMB();
  const t0 = Date.now();
  await js(`window.aquila.graphAddSource(${JSON.stringify(dir)})`);
  let notes = 0;
  for (let i = 0; i < 600 && notes < GRAPH_NOTES; i++) {
    await wait(100);
    notes = await js<number>(
      `window.aquila.graphStatus().then((s) => s.sources.find((x) => x.state === 'ready')?.notes ?? 0)`,
    );
  }
  const indexMs = Date.now() - t0;
  await wait(2000); // code names, index save
  const mainAfter = browserMB();
  const closedIdle = await measure(win, 5000);

  // T70: sessions in the graph. Smoke / perf re-read the transcripts on every snapshot (no hooks), so this is the
  // cold load each time; the app reads them once per finished turn.
  const transcripts = path.join(app.getPath('temp'), `aquila-smoke-graph-${process.pid}`, 'transcripts');
  writeTranscripts(transcripts, dir);
  const snapMs: number[] = [];
  let appCounts = { sessions: 0, files: 0, edges: 0 };
  for (let i = 0; i < 3; i++) {
    const s0 = Date.now();
    appCounts = await js(`window.aquila.graphSnapshot().then((g) => ({
      sessions: g.nodes.filter((n) => n.kind === 'session').length,
      files: g.nodes.filter((n) => n.kind === 'file').length,
      edges: g.edges.filter((e) => e.kind === 'action').length,
    }))`);
    snapMs.push(Date.now() - s0);
  }
  await wait(1500); // the scan workers exit
  const mainWithApp = browserMB();

  await js('window.__graphSettled = null');
  press(win, 'N', ['meta', 'shift']);
  let settled: { nodes: number; ms: number; iterations: number; via: string } | null = null;
  for (let i = 0; i < 200 && !settled; i++) {
    await wait(100);
    settled = await js('window.__graphSettled ?? null');
  }
  await wait(500);
  const openIdle = await measure(win, 5000);
  const box = await js<{ x: number; y: number } | null>(`(() => {
    const r = document.querySelector('.c-kgraph')?.getBoundingClientRect();
    return r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null;
  })()`);
  let zoom = null;
  if (box) {
    const zooming = measure(win, 3000);
    for (let i = 0; i < 60; i++) {
      win.webContents.sendInputEvent({
        type: 'mouseWheel',
        x: box.x,
        y: box.y,
        deltaX: 0,
        deltaY: i < 30 ? -40 : 40,
      });
      await wait(45);
    }
    zoom = await zooming;
  }
  press(win, 'N', ['meta', 'shift']);
  await wait(1000);
  const canvases = await js<number>(`document.querySelectorAll('.c-kgraph canvas').length`);
  const reclosedIdle = await measure(win, 5000);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(transcripts, { recursive: true, force: true });
  return {
    notes,
    indexMs,
    app: { ...appCounts, snapshotMs: snapMs, mainMB: mainWithApp - mainAfter },
    mainMB: { before: mainBefore, after: mainAfter, index: mainAfter - mainBefore },
    layout: settled,
    closedIdle: {
      cpu: closedIdle.cpu,
      cpuTotal: closedIdle.cpuTotal,
      wakeupsPerSec: closedIdle.wakeupsPerSec,
    },
    openIdle: {
      cpu: openIdle.cpu,
      cpuTotal: openIdle.cpuTotal,
      fps: openIdle.fps,
      rendererMB: openIdle.rendererMB,
    },
    zoom: zoom && { fps: zoom.fps, maxFrameGapMs: zoom.maxFrameGapMs, cpu: zoom.cpu },
    reclosedIdle: { cpu: reclosedIdle.cpu, cpuTotal: reclosedIdle.cpuTotal, canvasesLeft: canvases },
  };
}
