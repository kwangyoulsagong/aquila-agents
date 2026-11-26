import { describe, expect, it } from 'vitest';
import { placeLabels, type LabelCandidate } from './labels';

const c = (id: string, x: number, y: number, priority = 0, width = 100, r = 5): LabelCandidate => ({
  id,
  x,
  y,
  r,
  width,
  priority,
});
const view = { width: 1000, height: 800 };

describe('placeLabels', () => {
  it('keeps two labels that would overlap apart: the more important one wins', () => {
    const shown = placeLabels([c('a', 100, 100, 0), c('b', 150, 104, 1)], view);
    expect([...shown]).toEqual(['b']);
  });

  it('shows labels with room between them', () => {
    expect(placeLabels([c('a', 100, 100), c('b', 100, 140), c('c', 400, 100)], view).size).toBe(3);
  });

  it('bigger nodes go first at equal priority', () => {
    const shown = placeLabels([c('small', 100, 100, 0, 100, 4), c('big', 120, 100, 0, 100, 12)], view);
    expect([...shown]).toEqual(['big']);
  });

  it('a long label gives way to a dot it would run under; that dot keeps its label', () => {
    const shown = placeLabels([c('long', 10, 100, 1, 600), c('right', 500, 100, 0)], view);
    expect([...shown]).toEqual(['right']);
  });

  it('a long label blocks a label it would cross (no dot in the way)', () => {
    const shown = placeLabels([c('long', 10, 100, 1, 600), c('below', 300, 108, 0)], view, [
      c('long', 10, 100),
    ]);
    expect([...shown]).toEqual(['long']);
  });

  it('skips labels off screen or cut at the edge, without letting them block others', () => {
    const shown = placeLabels([c('off', -500, 100, 9), c('cut', 950, 300, 9), c('on', 100, 100)], view);
    expect([...shown]).toEqual(['on']);
  });

  it('a label never runs under another node', () => {
    const label = c('a', 100, 100);
    const dot = { id: 'dot', x: 160, y: 102, r: 6 };
    expect(placeLabels([label], view, [label, dot]).size).toBe(0);
    expect(placeLabels([label], view, [label]).size).toBe(1);
  });

  it('no two shown boxes overlap in a dense cluster', () => {
    const many = Array.from({ length: 200 }, (_, i) =>
      c(`n${i}`, (i * 37) % 600, (i * 53) % 400, 0, 60 + (i % 5) * 30),
    );
    const shown = placeLabels(many, view);
    const boxes = many
      .filter((m) => shown.has(m.id))
      .map((m) => ({ x1: m.x + m.r + 3, x2: m.x + m.r + 3 + m.width, y1: m.y - 7, y2: m.y + 7 }));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        expect(a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1).toBe(false);
      }
    expect(shown.size).toBeGreaterThan(5);
  });
});
