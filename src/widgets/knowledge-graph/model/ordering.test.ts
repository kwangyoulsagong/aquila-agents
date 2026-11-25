import { describe, expect, it } from 'vitest';
import { countCrossings, orderTwoLayers, placeColumn, prng, type LayerEdge } from './ordering';

/** Brute-force crossing count: two edges cross when their ends are in opposite order. */
const naive = (edges: readonly LayerEdge[]) => {
  let c = 0;
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a1, b1] = edges[i]!;
      const [a2, b2] = edges[j]!;
      if ((a1 - a2) * (b1 - b2) < 0) c++;
    }
  return c;
};

describe('countCrossings', () => {
  it('matches the pairwise count on random layer pairs', () => {
    const rand = prng(42);
    for (let t = 0; t < 200; t++) {
      const na = 1 + Math.floor(rand() * 12);
      const nb = 1 + Math.floor(rand() * 12);
      const edges: LayerEdge[] = [];
      for (let e = 0; e < Math.floor(rand() * 30); e++)
        edges.push([Math.floor(rand() * na), Math.floor(rand() * nb)]);
      expect(countCrossings(edges, nb)).toBe(naive(edges));
    }
  });

  it('is 0 for parallel edges and counts a full reversal', () => {
    expect(
      countCrossings(
        [
          [0, 0],
          [1, 1],
          [2, 2],
        ],
        3,
      ),
    ).toBe(0);
    expect(
      countCrossings(
        [
          [0, 2],
          [1, 1],
          [2, 0],
        ],
        3,
      ),
    ).toBe(3);
  });
});

describe('orderTwoLayers', () => {
  it('untangles a crossing it can untangle, and keeps the rank order otherwise', () => {
    // A0–B1, A1–B0: one swap removes the crossing.
    const r = orderTwoLayers(2, 2, [
      [0, 1],
      [1, 0],
    ]);
    expect(r.crossings).toBe(0);
    // Nothing to untangle → identity.
    const id = orderTwoLayers(3, 3, [
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(id).toEqual({ a: [0, 1, 2], b: [0, 1, 2], crossings: 0 });
  });

  it('finds no crossings for a forest, exhaustive and with restarts', () => {
    for (const na of [5, 12]) {
      const edges: LayerEdge[] = [];
      // Every A item gets two children; children are listed in reverse so the start order is tangled.
      for (let a = 0; a < na; a++) {
        edges.push([a, 2 * na - 1 - 2 * a]);
        edges.push([a, 2 * na - 2 - 2 * a]);
      }
      const r = orderTwoLayers(na, 2 * na, edges, 7);
      expect(r.crossings).toBe(0);
    }
  });

  it('is deterministic', () => {
    const rand = prng(3);
    const edges: LayerEdge[] = [];
    for (let e = 0; e < 40; e++) edges.push([Math.floor(rand() * 10), Math.floor(rand() * 14)]);
    expect(orderTwoLayers(10, 14, edges, 9)).toEqual(orderTwoLayers(10, 14, edges, 9));
  });

  it('never does worse than the start order', () => {
    const rand = prng(11);
    for (let t = 0; t < 30; t++) {
      const na = 2 + Math.floor(rand() * 12);
      const nb = 2 + Math.floor(rand() * 12);
      const edges: LayerEdge[] = [];
      for (let e = 0; e < na + nb; e++) edges.push([Math.floor(rand() * na), Math.floor(rand() * nb)]);
      expect(orderTwoLayers(na, nb, edges, t).crossings).toBeLessThanOrEqual(countCrossings(edges, nb));
    }
  });
});

describe('placeColumn', () => {
  it('keeps order and the gap, and sits on free targets', () => {
    expect(placeColumn([0, 5, 10])).toEqual([0, 5, 10]);
    const ys = placeColumn([2, 2, 2]);
    expect(ys).toEqual([1, 2, 3]);
  });

  it('follows the item before for a missing target', () => {
    expect(placeColumn([4, Number.NaN])).toEqual([4, 5]);
    expect(placeColumn([Number.NaN, Number.NaN])).toEqual([0, 1]);
  });

  it('never overlaps', () => {
    const rand = prng(5);
    for (let t = 0; t < 50; t++) {
      const targets = Array.from({ length: 1 + Math.floor(rand() * 10) }, () => rand() * 6 - 3);
      const ys = placeColumn(targets);
      for (let i = 1; i < ys.length; i++) expect(ys[i]! - ys[i - 1]!).toBeGreaterThanOrEqual(1 - 1e-9);
    }
  });
});
