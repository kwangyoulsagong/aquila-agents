import { describe, expect, it } from 'vitest';
import {
  closePane,
  createLayout,
  drop,
  focusedLeaf,
  leaves,
  MAX_PANES,
  neighbor,
  paneCount,
  place,
  rects,
  removeSession,
  show,
  split,
  zoneAt,
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
