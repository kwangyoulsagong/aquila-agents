// `npm run perf`: 15 real shell sessions opened from the UI (2 on screen in a split, 13 hidden), measured idle and
// while every session streams agent-like output. Prints one JSON line `[perf] {...}` and exits 0.
// Numbers: CPU % per process type (app.getAppMetrics), renderer memory, session:data messages/s reaching the
// renderer, and renderer frames (fps, longest gap) — the "does it stay smooth" part.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { SessionManager } from './sessions';
import { IPC } from '../src/shared/api/types';

// Measure a window that paints, even behind other windows: macOS occlusion stops frames (fps 0, a `yes` flood
// never drawn), which makes the numbers meaningless. Set here, before app ready (smoke.ts imports this at load).
if (process.env.AQUILA_PERF === '1' && process.env.AQUILA_PERF_NO_SWITCHES !== '1') {
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
  app.commandLine.appendSwitch('disable-features', 'MacWebContentsOcclusion');
}

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

/**
 * The renderer's JS heap in use (MB), exact through the DevTools protocol (`performance.memory` is bucketed). The
 * rest of `rendererMB` is native memory: xterm's typed arrays, DOM, GPU buffers, allocator slack.
 */
async function jsHeap(win: BrowserWindow): Promise<number> {
  const d = win.webContents.debugger;
  try {
    if (!d.isAttached()) d.attach('1.3');
    const u = (await d.sendCommand('Runtime.getHeapUsage')) as { usedSize: number };
    return Math.round(u.usedSize / 1048576);
  } catch {
    return -1;
  }
}

/** JS heap after a full GC: what is really kept, as opposed to garbage V8 hasn't collected yet. */
async function liveHeap(win: BrowserWindow): Promise<number> {
  try {
    await win.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
  } catch {
    return -1;
  }
  return jsHeap(win);
}

interface SampleNode {
  callFrame: { functionName: string; url: string; lineNumber: number };
  selfSize: number;
  children: SampleNode[];
}

/**
 * AQUILA_PERF_HEAP=1: what keeps the flood's heap. V8's sampling heap profiler lists allocation sites of objects
 * still alive when it stops (after a full GC); the top sites by size, with their callers, go to the log.
 */
async function heapSites(win: BrowserWindow, run: () => Promise<void>): Promise<string[]> {
  const d = win.webContents.debugger;
  if (!d.isAttached()) d.attach('1.3');
  await d.sendCommand('HeapProfiler.enable');
  await d.sendCommand('HeapProfiler.startSampling', { samplingInterval: 32768 });
  await run();
  await d.sendCommand('HeapProfiler.collectGarbage');
  const { profile } = (await d.sendCommand('HeapProfiler.stopSampling')) as { profile: { head: SampleNode } };
  const sites = new Map<string, number>();
  const walk = (n: SampleNode, stack: string[]) => {
    const f = n.callFrame;
    const here = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
    const s = [...stack, here].slice(-4);
    if (n.selfSize) sites.set(s.join(' < '), (sites.get(s.join(' < ')) ?? 0) + n.selfSize);
    for (const c of n.children) walk(c, s);
  };
  walk(profile.head, []);
  return [...sites]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([k, v]) => `${Math.round(v / 1048576)} MB  ${k.split(' < ').reverse().join(' < ')}`);
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
    `(() => {
      const p = window.__perf; p.on = false; window.__perfOff();
      return p;
    })()`,
  );
  const heap = await jsHeap(win);
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
    /** Renderer JS heap in use (the rest of rendererMB is native: xterm buffers' typed arrays count here too). */
    heapMB: heap,
    totalMB: Math.round(totalMB),
    /** Idle wakeups/s summed over all app processes (T9). */
    wakeupsPerSec: Math.round(wakeups),
    msgsPerSec: Math.round(r.msgs / secs),
    fps: Math.round(r.frames / secs),
    maxFrameGapMs: Math.round(r.maxGap),
  };
}

/**
 * Busy agents: status changes (working ↔ idle, no notification) at 100/s across all sessions, nothing else. What
 * one status event costs the renderer (the whole workspace re-rendering or only the changed dot).
 */
async function stormStatus(win: BrowserWindow, ids: string[]) {
  let flip = 0;
  const storm = setInterval(() => {
    const id = ids[flip % ids.length]!;
    win.webContents.send(IPC.sessionStatus, {
      id,
      status: Math.floor(flip / ids.length) % 2 ? 'idle' : 'working',
      since: Date.now(),
    });
    flip++;
  }, 10);
  await wait(500);
  const m = await measure(win, 5000);
  clearInterval(storm);
  await wait(500);
  return m;
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  children?: number[];
}

/** AQUILA_PERF_STARTUP_PROFILE=1: reloads the page under the CPU profiler and prints where its startup time goes. */
async function profileReload(win: BrowserWindow): Promise<void> {
  const d = win.webContents.debugger;
  if (!d.isAttached()) d.attach('1.3');
  // Every request of the reload: when it started and finished (file:// isn't in Resource Timing).
  const reqs = new Map<string, { url: string; start: number; end?: number }>();
  const onMsg = (_e: unknown, method: string, p: Record<string, unknown>) => {
    if (method === 'Network.requestWillBeSent')
      reqs.set(p.requestId as string, { url: (p.request as { url: string }).url, start: p.timestamp as number });
    else if (method === 'Network.loadingFinished' || method === 'Network.loadingFailed') {
      const r = reqs.get(p.requestId as string);
      if (r) r.end = p.timestamp as number;
    }
  };
  d.on('message', onMsg);
  await d.sendCommand('Network.enable');
  await d.sendCommand('Profiler.enable');
  await d.sendCommand('Profiler.setSamplingInterval', { interval: 500 });
  await d.sendCommand('Profiler.start');
  win.webContents.reload();
  await wait(7000);
  const { profile } = (await d.sendCommand('Profiler.stop')) as {
    profile: { nodes: ProfileNode[]; samples: number[]; timeDeltas: number[] };
  };
  d.off('message', onMsg);
  const all = [...reqs.values()];
  const t0 = Math.min(...all.map((r) => r.start));
  console.log(
    `[perf] startup requests (ms from the first):\n  ${all
      .map((r) => `${Math.round((r.start - t0) * 1000)}→${r.end ? Math.round((r.end - t0) * 1000) : '?'} ${r.url.split('/').pop()?.slice(0, 60)}`)
      .join('\n  ')}`,
  );
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byName = new Map<string, number>();
  for (const n of profile.nodes) {
    const f = n.callFrame;
    const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}:${f.columnNumber}`;
    byName.set(key, (byName.get(key) ?? 0) + (self.get(n.id) ?? 0));
  }
  const top = [...byName].sort((a, b) => b[1] - a[1]).slice(0, 15);
  console.log(`[perf] startup profile (self ms):\n  ${top.map(([k, v]) => `${Math.round(v / 1000)} ${k}`).join('\n  ')}`);
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
  // Startup: first paint and DOMContentLoaded of the page (the main chunk parsed and run, the app's first render).
  const startup = await win.webContents.executeJavaScript(`(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    const res = performance.getEntriesByType('resource');
    const main = res.find((r) => r.name.includes('/assets/index-') && r.name.endsWith('.js'));
    const ms = (n) => Math.round(n ?? -1);
    return {
      htmlMs: ms(nav?.responseEnd),
      mainChunk: main && { startMs: ms(main.startTime), endMs: ms(main.responseEnd), kb: Math.round(main.decodedBodySize / 1024) },
      domContentLoadedMs: ms(nav?.domContentLoadedEventEnd),
      firstPaintMs: ms(fcp?.startTime),
      slowest: res.sort((a, b) => b.responseEnd - a.responseEnd).slice(0, 4)
        .map((r) => r.name.split('/').pop() + ' ' + ms(r.startTime) + '→' + ms(r.responseEnd)),
    };
  })()`);
  // AQUILA_PERF_STARTUP=1: only that (run it a few times: one launch is noisy).
  if (process.env.AQUILA_PERF_STARTUP === '1') {
    console.log(`[perf] startup ${JSON.stringify(startup)}`);
    if (process.env.AQUILA_PERF_STARTUP_PROFILE === '1') await profileReload(win);
    return app.exit(0);
  }
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

  win.webContents.setBackgroundThrottling(false);
  const idle = await measure(win);
  if (idle.fps < 30) {
    console.error(`[perf] FAIL: the window isn't painting (${idle.fps} fps), numbers would be meaningless`);
    await sessions.killAll();
    return app.exit(1);
  }
  for (const id of ids) sessions.write(id, STREAM);
  await wait(2000);
  const streaming = await measure(win);
  for (const id of ids) sessions.write(id, '\x03');
  await wait(1000);

  const statusStorm = await stormStatus(win, ids);

  // Flood: `yes` in a session on screen. Smooth = frames keep coming; responsive = Ctrl+C answers fast.
  const flooded = ids[ids.length - 1]!;
  let flood!: Awaited<ReturnType<typeof measure>>;
  const floodRun = async () => {
    sessions.write(flooded, 'yes\r');
    await wait(1000);
    flood = await measure(win, FLOOD_MS);
  };
  if (process.env.AQUILA_PERF_HEAP === '1') {
    const sites = await heapSites(win, async () => {
      await floodRun();
      sessions.write(flooded, '\x03');
      await wait(1500);
    });
    console.log(`[perf] heap kept after the flood, by allocation site:\n  ${sites.join('\n  ')}`);
    sessions.write(flooded, 'yes\r');
    await wait(500);
  } else await floodRun();
  // What draws the on-screen terminals (WebGL canvas vs DOM rows), and the page's DOM size: native memory, not JS heap.
  const drawing = await win.webContents.executeJavaScript(`(() => {
    const shown = [...document.querySelectorAll('.term-host:not([hidden])')];
    return {
      webglOnScreen: shown.filter((h) => h.querySelector('.xterm-screen canvas')).length,
      domRowsOnScreen: shown.reduce((n, h) => n + h.querySelectorAll('.xterm-rows > div').length, 0),
      domNodes: document.getElementsByTagName('*').length,
    };
  })()`);
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

  // After Ctrl+C: was the flood's heap kept (a leak) or garbage? Live heap after a full GC.
  const floodLiveHeapMB = await liveHeap(win);
  // AQUILA_PERF_SKIP_GRAPH=1: terminals only (a quicker run while working on the workspace).
  const graph = process.env.AQUILA_PERF_SKIP_GRAPH === '1' ? null : await measureGraph(win, ids);

  console.log(
    `[perf] ${JSON.stringify({ sessions: ids.length, visible, startup, idle, streaming, statusStorm, flood: { ...flood, ctrlCMs, drawing, liveHeapMB: floodLiveHeapMB }, graph })}`,
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
async function measureGraph(win: BrowserWindow, ids: string[]) {
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
  // A second window: work left over from indexing (code names) has finished by now; an idle loop would still show.
  const closedIdleLater = await measure(win, 5000);

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

  // The map (the whole graph, WebGL + layout worker) is what has a budget; the focus view is a few dozen DOM nodes.
  await js(`(() => { localStorage.setItem('aquila.graph.mode', 'map'); window.__graphSettled = null; })()`);
  press(win, 'N', ['meta', 'shift']);
  let settled: { nodes: number; ms: number; iterations: number; via: string } | null = null;
  for (let i = 0; i < 200 && !settled; i++) {
    await wait(100);
    settled = await js(`(() => { const s = window.__graphSettled; return s && s.via !== 'focus' ? s : null; })()`);
  }
  await wait(500);
  const openIdle = await measure(win, 5000);
  // Status changes while the graph is open: the panel must not re-render with every session dot.
  const openStorm = await stormStatus(win, ids);
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
      later: { cpuTotal: closedIdleLater.cpuTotal, wakeupsPerSec: closedIdleLater.wakeupsPerSec },
    },
    openIdle: {
      cpu: openIdle.cpu,
      cpuTotal: openIdle.cpuTotal,
      fps: openIdle.fps,
      rendererMB: openIdle.rendererMB,
      wakeupsPerSec: openIdle.wakeupsPerSec,
    },
    openStorm: { cpu: openStorm.cpu, cpuTotal: openStorm.cpuTotal, fps: openStorm.fps, maxFrameGapMs: openStorm.maxFrameGapMs },
    zoom: zoom && { fps: zoom.fps, maxFrameGapMs: zoom.maxFrameGapMs, cpu: zoom.cpu },
    reclosedIdle: {
      cpu: reclosedIdle.cpu,
      cpuTotal: reclosedIdle.cpuTotal,
      wakeupsPerSec: reclosedIdle.wakeupsPerSec,
      canvasesLeft: canvases,
    },
  };
}
