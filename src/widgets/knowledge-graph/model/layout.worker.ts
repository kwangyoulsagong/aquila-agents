/// <reference lib="webworker" />
import { createLayout, SETTLED, type Layout } from './layout';
import type { LayoutRequest, LayoutReply } from './layoutProtocol';

// Runs the force layout off the UI thread in ~12 ms slices. Stops by itself when the picture settles or after
// `maxMs`; the panel terminates the whole worker when it's done or hidden, so nothing stays alive in between.

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const SLICE_MS = 12;
const TICK_MS = 100;

let run = 0;

function post(reply: LayoutReply) {
  ctx.postMessage(reply, [reply.xy.buffer]);
}

function start(req: Extract<LayoutRequest, { type: 'start' }>) {
  const id = ++run;
  const layout: Layout = createLayout(req);
  const began = performance.now();
  let lastTick = began;
  let iterations = 0;
  const slice = () => {
    if (id !== run) return;
    const end = performance.now() + SLICE_MS;
    let moved = Infinity;
    while (performance.now() < end) {
      moved = layout.step(5);
      iterations += 5;
      if (moved < SETTLED) break;
    }
    const now = performance.now();
    if (moved < SETTLED || now - began >= req.maxMs) {
      post({ type: 'done', xy: layout.positions(), iterations, ms: Math.round(now - began) });
      run++;
      return;
    }
    if (req.animate && now - lastTick >= TICK_MS) {
      lastTick = now;
      post({ type: 'tick', xy: layout.positions(), iterations, ms: Math.round(now - began) });
    }
    setTimeout(slice, 0);
  };
  slice();
}

ctx.onmessage = (e: MessageEvent<LayoutRequest>) => {
  if (e.data.type === 'start') start(e.data);
  else run++;
};
