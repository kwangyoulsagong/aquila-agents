import { createLayout, SETTLED } from './layout';
import type { LayoutReply, LayoutRequest } from './layoutProtocol';

export interface LayoutRun {
  /** Stops the run (the worker is terminated); `onDone` is not called. */
  stop(): void;
}

interface Handlers {
  onTick(xy: Float32Array): void;
  onDone(xy: Float32Array, info: { iterations: number; ms: number; via: 'worker' | 'thread' }): void;
}

/** Hard stop for a run: the picture is what it is after this (performance budget, T63–T71). */
export const MAX_LAYOUT_MS = 3000;

/**
 * Runs one layout in a fresh worker and terminates it when the layout settles, after 3 s, or on `stop()` — no worker
 * outlives a run. If a worker can't start, the same slices run on this thread between frames.
 */
export function runLayout(
  input: Omit<Extract<LayoutRequest, { type: 'start' }>, 'type' | 'maxMs'>,
  h: Handlers,
): LayoutRun {
  let stopped = false;
  let worker: Worker | null = null;
  let fallback: LayoutRun | null = null;
  const startFallback = () => {
    worker?.terminate();
    worker = null;
    if (!stopped) fallback = runHere(input, h);
  };
  try {
    worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    startFallback();
    return { stop: () => ((stopped = true), fallback?.stop()) };
  }
  worker.onmessage = (e: MessageEvent<LayoutReply>) => {
    if (stopped) return;
    if (e.data.type === 'tick') h.onTick(e.data.xy);
    else {
      worker?.terminate();
      worker = null;
      h.onDone(e.data.xy, { iterations: e.data.iterations, ms: e.data.ms, via: 'worker' });
    }
  };
  worker.onerror = (e) => {
    e.preventDefault();
    startFallback();
  };
  const req: LayoutRequest = { type: 'start', ...input, maxMs: MAX_LAYOUT_MS };
  // Copied, not transferred: the fallback still needs the arrays if the worker fails to load.
  worker.postMessage(req);
  return {
    stop() {
      stopped = true;
      worker?.terminate();
      worker = null;
      fallback?.stop();
    },
  };
}

/** Same loop as the worker, on this thread in 8 ms slices (only if workers are unavailable). */
function runHere(
  input: Omit<Extract<LayoutRequest, { type: 'start' }>, 'type' | 'maxMs'>,
  h: Handlers,
): LayoutRun {
  const layout = createLayout(input);
  const began = performance.now();
  let lastTick = began;
  let iterations = 0;
  let timer = 0;
  const slice = () => {
    const end = performance.now() + 8;
    let moved = Infinity;
    while (performance.now() < end && moved >= SETTLED) {
      moved = layout.step(5);
      iterations += 5;
    }
    const now = performance.now();
    if (moved < SETTLED || now - began >= MAX_LAYOUT_MS) {
      h.onDone(layout.positions(), { iterations, ms: Math.round(now - began), via: 'thread' });
      return;
    }
    if (input.animate && now - lastTick >= 100) {
      lastTick = now;
      h.onTick(layout.positions());
    }
    timer = window.setTimeout(slice, 16);
  };
  timer = window.setTimeout(slice, 0);
  return { stop: () => clearTimeout(timer) };
}
