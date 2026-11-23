import { describe, expect, it } from 'vitest';
import { createLayout, hash01, seedPositions, SETTLED } from './layout';

/** Two triangles joined by one edge. */
const pairs: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 0],
  [3, 4],
  [4, 5],
  [5, 3],
  [2, 3],
];
const ids = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('layout', () => {
  it('settles, and linked nodes end up closer than unlinked ones', () => {
    const xy = seedPositions(ids, pairs, new Map());
    const layout = createLayout({
      xy,
      edges: Uint32Array.from(pairs.flat()),
      weights: new Float32Array(pairs.length).fill(1),
    });
    let moved = Infinity;
    for (let i = 0; i < 400 && moved >= SETTLED; i++) moved = layout.step(5);
    expect(moved).toBeLessThan(SETTLED);
    const p = layout.positions();
    const d = (i: number, j: number) => Math.hypot(p[i * 2]! - p[j * 2]!, p[i * 2 + 1]! - p[j * 2 + 1]!);
    expect(d(0, 1)).toBeLessThan(d(0, 5));
    expect([...p].every(Number.isFinite)).toBe(true);
  });

  it('handles an empty graph', () => {
    const layout = createLayout({
      xy: new Float32Array(),
      edges: new Uint32Array(),
      weights: new Float32Array(),
    });
    expect(layout.step(5)).toBe(0);
    expect(layout.positions()).toHaveLength(0);
  });
});

describe('seedPositions', () => {
  it('keeps known positions and puts new nodes next to a placed neighbour', () => {
    const xy = seedPositions(['a', 'b', 'z'], [[0, 1]], new Map([['a', { x: 100, y: -50 }]]));
    expect([xy[0], xy[1]]).toEqual([100, -50]);
    expect(Math.hypot(xy[2]! - 100, xy[3]! + 50)).toBeCloseTo(5, 3);
  });

  it('is stable for the same ids', () => {
    expect(seedPositions(ids, [], new Map())).toEqual(seedPositions(ids, [], new Map()));
    expect(hash01('x')).toBeGreaterThanOrEqual(0);
    expect(hash01('x')).toBeLessThanOrEqual(1);
  });
});
