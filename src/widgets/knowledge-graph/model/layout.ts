import iterate, { type Fa2Options } from 'graphology-layout-forceatlas2/iterate.js';

// Force layout (ForceAtlas2) over packed arrays, so the worker needs no graph library. Pure: the worker drives it,
// tests run it directly.

const PPN = 10; // floats per node in the FA2 matrix
const PPE = 3; // floats per edge

export interface LayoutInput {
  /** Start positions, interleaved x,y per node. */
  xy: Float32Array;
  /** Node index pairs. */
  edges: Uint32Array;
  /** One weight per edge (its strength). */
  weights: Float32Array;
}

export interface Layout {
  /** Runs `n` iterations; returns how far nodes moved on the last one, relative to the spread of the graph. */
  step(n: number): number;
  /** Current positions, interleaved x,y. */
  positions(): Float32Array;
}

/** Settings ForceAtlas2's authors infer for a graph of this size (`inferSettings`), with more repulsion for big ones. */
export function settingsFor(order: number): Fa2Options {
  return {
    linLogMode: false,
    outboundAttractionDistribution: false,
    adjustSizes: false,
    edgeWeightInfluence: 1,
    // 2 (the inferred value) packed a vault of 1,000+ notes into one overlapping blob.
    scalingRatio: order > 100 ? 6 : 10,
    strongGravityMode: true,
    // Small graphs: pull separate clusters in so they don't sit in far corners.
    gravity: order < 200 ? 1 : 0.05,
    slowDown: 1 + Math.log(Math.max(1, order)),
    barnesHutOptimize: order > 500,
    barnesHutTheta: 0.6,
  };
}

/** Below this relative move per iteration the picture no longer changes visibly. */
export const SETTLED = 0.0008;

export function createLayout(input: LayoutInput): Layout {
  const order = input.xy.length / 2;
  const nodes = new Float32Array(order * PPN);
  for (let i = 0; i < order; i++) {
    const j = i * PPN;
    nodes[j] = input.xy[i * 2]!;
    nodes[j + 1] = input.xy[i * 2 + 1]!;
    nodes[j + 6] = 1; // mass, grows with degree below
    nodes[j + 7] = 1; // convergence
    nodes[j + 8] = 1; // size
  }
  const size = input.weights.length;
  const edges = new Float32Array(size * PPE);
  for (let e = 0; e < size; e++) {
    const s = input.edges[e * 2]! * PPN;
    const t = input.edges[e * 2 + 1]! * PPN;
    const w = input.weights[e]!;
    edges[e * PPE] = s;
    edges[e * PPE + 1] = t;
    edges[e * PPE + 2] = w;
    nodes[s + 6]! += w;
    nodes[t + 6]! += w;
  }
  const options = settingsFor(order);
  const prev = new Float32Array(order * 2);

  return {
    step(n) {
      if (!order) return 0;
      for (let k = 0; k < n; k++) {
        if (k === n - 1)
          for (let i = 0; i < order; i++) {
            prev[i * 2] = nodes[i * PPN]!;
            prev[i * 2 + 1] = nodes[i * PPN + 1]!;
          }
        iterate(options, nodes, edges);
      }
      let moved = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < order; i++) {
        const x = nodes[i * PPN]!;
        const y = nodes[i * PPN + 1]!;
        moved += Math.hypot(x - prev[i * 2]!, y - prev[i * 2 + 1]!);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      const spread = Math.max(maxX - minX, maxY - minY, 1e-6);
      return moved / order / spread;
    },
    positions() {
      const out = new Float32Array(order * 2);
      for (let i = 0; i < order; i++) {
        out[i * 2] = nodes[i * PPN]!;
        out[i * 2 + 1] = nodes[i * PPN + 1]!;
      }
      return out;
    },
  };
}

/** Deterministic 0–1 from a string (FNV-1a), so a node starts in the same place every time. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Start positions: where a node was last time (so a change in the index doesn't reshuffle the picture), else next
 * to a placed neighbour, else a stable spot on a disc sized for the graph.
 */
export function seedPositions(
  ids: string[],
  pairs: [number, number][],
  known: ReadonlyMap<string, { x: number; y: number }>,
): Float32Array {
  const xy = new Float32Array(ids.length * 2);
  const placed = new Uint8Array(ids.length);
  const radius = Math.sqrt(ids.length) * 10 + 10;
  ids.forEach((id, i) => {
    const p = known.get(id);
    if (!p) return;
    xy[i * 2] = p.x;
    xy[i * 2 + 1] = p.y;
    placed[i] = 1;
  });
  for (const [a, b] of pairs) {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      if (placed[from] && !placed[to]) {
        const angle = hash01(ids[to]!) * Math.PI * 2;
        xy[to * 2] = xy[from * 2]! + Math.cos(angle) * 5;
        xy[to * 2 + 1] = xy[from * 2 + 1]! + Math.sin(angle) * 5;
        placed[to] = 1;
      }
    }
  }
  ids.forEach((id, i) => {
    if (placed[i]) return;
    const angle = hash01(id) * Math.PI * 2;
    const r = Math.sqrt(hash01(`${id}#r`)) * radius;
    xy[i * 2] = Math.cos(angle) * r;
    xy[i * 2 + 1] = Math.sin(angle) * r;
  });
  return xy;
}
