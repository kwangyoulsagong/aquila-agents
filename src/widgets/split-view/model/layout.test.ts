import { describe, expect, it } from 'vitest';
import {
  closePane,
  createLayout,
  dividers,
  drop,
  focus,
  focusedLeaf,
  focusedOnly,
  fromSaved,
  leaves,
  MAX_PANES,
  neighbor,
  nudge,
  paneCount,
  place,
  rects,
  removeSession,
  resize,
  show,
  split,
  toggleZoom,
  toSaved,
  visibleRects,
  zoneAt,
  zoomed,
  type Branch,
  type Layout,
} from './layout';

const sessions = (l: Layout) => leaves(l.root).map((x) => x.sessionId);

/** a | b, then b split down into b / c → [a | (b / c)] */
function threePanes(): Layout {
  let l = createLayout('a');
  l = split(l, l.focusedId, 'right', 'b');
  l = split(l, l.focusedId, 'bottom', 'c');
  return l;
}

describe('split', () => {
  it('adds a focused pane on the given edge', () => {
    const l = split(createLayout('a'), 'p1', 'right', 'b');
    expect(sessions(l)).toEqual(['a', 'b']);
    expect(focusedLeaf(l).sessionId).toBe('b');
    expect(split(createLayout('a'), 'p1', 'left', 'b').root).toMatchObject({
      dir: 'row',
      a: { sessionId: 'b' },
    });
    expect(split(createLayout('a'), 'p1', 'top', null).root).toMatchObject({ dir: 'column' });
  });

  it('stops at MAX_PANES', () => {
    let l = threePanes();
    l = split(l, l.focusedId, 'right', 'd');
    expect(paneCount(l)).toBe(MAX_PANES);
    expect(split(l, l.focusedId, 'right', 'e')).toBe(l);
  });

  it('moves a session that is already on screen instead of duplicating it', () => {
    const l = split(threePanes(), 'p1', 'bottom', 'c');
    expect(paneCount(l)).toBe(3);
    expect(sessions(l).sort()).toEqual(['a', 'b', 'c']);
    expect(sessions(l).filter((s) => s === 'c')).toHaveLength(1);
  });

  it('ignores splitting a pane with its own session', () => {
    const l = threePanes();
    expect(split(l, 'p1', 'right', 'a')).toBe(l);
  });

  it('keeps pane ids unique', () => {
    const l = split(threePanes(), 'p1', 'bottom', 'c');
    const ids = leaves(l.root).map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('closePane / removeSession', () => {
  it('collapses into the sibling and moves focus there', () => {
    const l = closePane(threePanes(), 'p3');
    expect(sessions(l)).toEqual(['a', 'b']);
    expect(focusedLeaf(l).sessionId).toBe('b');
  });

  it('never removes the last pane', () => {
    const l = createLayout('a');
    expect(closePane(l, 'p1')).toBe(l);
  });

  it('closing a session collapses its pane, or shows the fallback in a single pane', () => {
    expect(sessions(removeSession(threePanes(), 'b', 'x'))).toEqual(['a', 'c']);
    expect(sessions(removeSession(createLayout('a'), 'a', 'x'))).toEqual(['x']);
    expect(sessions(removeSession(createLayout('a'), 'a', null))).toEqual([null]);
    const l = threePanes();
    expect(removeSession(l, 'zzz', null)).toBe(l);
  });
});

describe('place / show / drop', () => {
  it('show focuses the pane already showing a session', () => {
    const l = show(threePanes(), 'a');
    expect(l.focusedId).toBe('p1');
    expect(sessions(l)).toEqual(['a', 'b', 'c']);
  });

  it('show puts an off-screen session into the focused pane', () => {
    expect(sessions(show(threePanes(), 'd'))).toEqual(['a', 'b', 'd']);
  });

  it('place swaps when the session is in another pane', () => {
    expect(sessions(place(threePanes(), 'p1', 'c'))).toEqual(['c', 'b', 'a']);
  });

  it('drop on center replaces, on an edge splits', () => {
    expect(sessions(drop(createLayout('a'), 'p1', 'center', 'b'))).toEqual(['b']);
    expect(sessions(drop(createLayout('a'), 'p1', 'bottom', 'b'))).toEqual(['a', 'b']);
  });
});

describe('geometry', () => {
  it('lays panes out in halves', () => {
    const r = rects(threePanes().root).map(({ x, y, w, h }) => [x, y, w, h]);
    expect(r).toEqual([
      [0, 0, 0.5, 1],
      [0.5, 0, 0.5, 0.5],
      [0.5, 0.5, 0.5, 0.5],
    ]);
  });

  it('finds neighbours by direction', () => {
    const l = threePanes(); // focused: c (bottom right)
    expect(neighbor(l, 'top')).toBe('p2');
    expect(neighbor(l, 'left')).toBe('p1');
    expect(neighbor(l, 'right')).toBeNull();
    expect(neighbor({ ...l, focusedId: 'p1' }, 'right')).toBe('p2');
  });

  it('maps a point to a drop zone', () => {
    expect(zoneAt(0.1, 0.5)).toBe('left');
    expect(zoneAt(0.9, 0.5)).toBe('right');
    expect(zoneAt(0.5, 0.05)).toBe('top');
    expect(zoneAt(0.5, 0.95)).toBe('bottom');
    expect(zoneAt(0.5, 0.5)).toBe('center');
  });
});

describe('toSaved / fromSaved', () => {
  it('round-trips the tree and the focused pane', () => {
    let l = createLayout('s1');
    l = split(l, 'p1', 'right', 's2');
    l = split(l, l.focusedId, 'bottom', 's3');
    l = { ...l, focusedId: 'p2' };
    const saved = toSaved(l);
    expect(saved.focused).toBe(1);
    expect(JSON.stringify(saved)).not.toContain('"id"');
    const back = fromSaved(saved, new Set(['s1', 's2', 's3']))!;
    expect(sessions(back)).toEqual(['s1', 's2', 's3']);
    expect(focusedLeaf(back).sessionId).toBe('s2');
    expect(toSaved(back)).toEqual(saved);
  });

  it('empties panes of unknown or repeated sessions, rejects too many panes', () => {
    const leaf = (sessionId: string | null) => ({ kind: 'leaf' as const, sessionId });
    const back = fromSaved(
      {
        root: {
          kind: 'split',
          dir: 'row',
          a: leaf('s1'),
          b: { kind: 'split', dir: 'column', a: leaf('gone'), b: leaf('s1') },
        },
        focused: 9,
      },
      new Set(['s1']),
    )!;
    expect(sessions(back)).toEqual(['s1', null, null]);
    expect(back.focusedId).toBe('p1');
    const pair = { kind: 'split' as const, dir: 'row' as const, a: leaf(null), b: leaf(null) };
    const five = { kind: 'split' as const, dir: 'row' as const, a: { ...pair, a: pair }, b: pair };
    expect(fromSaved({ root: five, focused: 0 }, new Set())).toBeNull();
  });
});

describe('resize', () => {
  it('moves a divider and keeps both sides above the minimum', () => {
    let l = threePanes(); // [a | (b / c)]
    l = resize(l, '', 0.7);
    expect(rects(l.root).map((r) => +r.w.toFixed(4))).toEqual([0.7, 0.3, 0.3]);
    l = resize(l, 'b', 0.25);
    expect(+rects(l.root)[1].h.toFixed(4)).toBe(0.25);
    expect(dividers(l).map((d) => [d.path, d.dir, +d.ratio.toFixed(4)])).toEqual([
      ['', 'row', 0.7],
      ['b', 'column', 0.25],
    ]);
    expect((resize(l, '', 0.99).root as Branch).ratio).toBe(0.85);
    expect(resize(l, '', 0.7)).toBe(l);
  });

  it('nudges the nearest divider around the focused pane, in the arrow direction', () => {
    let l = threePanes(); // focused: c (bottom right)
    l = nudge(l, 'left');
    expect(+rects(l.root)[0].w.toFixed(4)).toBe(0.45);
    l = nudge(l, 'bottom');
    expect(+rects(l.root)[1].h.toFixed(4)).toBe(0.55);
    const single = createLayout('a');
    expect(nudge(single, 'left')).toBe(single);
  });

  it('keeps sizes across save and restore', () => {
    const l = resize(threePanes(), '', 0.3);
    const back = fromSaved(toSaved(l), new Set(['a', 'b', 'c']))!;
    expect(+rects(back.root)[0].w.toFixed(4)).toBe(0.3);
    const wild = { ...toSaved(l), root: { ...(toSaved(l).root as object), ratio: 5 } } as ReturnType<
      typeof toSaved
    >;
    expect(+rects(fromSaved(wild, new Set())!.root)[0].w.toFixed(4)).toBe(0.85);
  });
});

describe('zoom', () => {
  it('fills the stage with the focused pane and toggles back', () => {
    const l = threePanes();
    const z = toggleZoom(l);
    expect(zoomed(z)?.sessionId).toBe('c');
    expect(visibleRects(z)).toEqual([{ leaf: zoomed(z), x: 0, y: 0, w: 1, h: 1 }]);
    expect(dividers(z)).toEqual([]);
    expect(nudge(z, 'left')).toBe(z);
    expect(visibleRects(toggleZoom(z))).toHaveLength(3);
    expect(toggleZoom(createLayout('a')).zoomedId).toBeUndefined();
  });

  it('leaves zoom when another pane is focused, a pane is added or the zoomed pane closes', () => {
    const z = toggleZoom(threePanes());
    expect(zoomed(focus(z, 'p1'))).toBeNull();
    expect(zoomed(show(z, 'a'))).toBeNull();
    expect(zoomed(split(z, z.focusedId, 'right', null))).toBeNull();
    expect(zoomed(closePane(z, z.focusedId))).toBeNull();
    // A new session in the zoomed pane keeps it zoomed.
    expect(zoomed(place(z, z.focusedId, 'd'))?.sessionId).toBe('d');
    // Closing another pane keeps zoom; down to one pane drops it.
    expect(zoomed(closePane(z, 'p1'))?.id).toBe(z.zoomedId);
    expect(closePane(closePane(z, 'p1'), 'p2').zoomedId).toBeNull();
  });
});

describe('focusedOnly (full window)', () => {
  it('shows only the focused pane, without heads or dividers, and leaves the tree alone', () => {
    const l = toggleZoom(threePanes());
    const f = focusedOnly(l);
    expect(f.root).toBe(focusedLeaf(l));
    expect(f.root.kind).toBe('leaf');
    expect(visibleRects(f)).toEqual([{ leaf: focusedLeaf(l), x: 0, y: 0, w: 1, h: 1 }]);
    expect(dividers(f)).toEqual([]);
    expect(zoomed(l)?.id).toBe(l.focusedId);
    expect(focusedOnly(createLayout('a')).root).toMatchObject({ kind: 'leaf', sessionId: 'a' });
  });
});
