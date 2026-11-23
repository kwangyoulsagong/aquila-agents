import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '@/shared/api';
import { atPath, handlePrompt, handleTarget } from './handle';

const snap: GraphSnapshot = {
  version: 1,
  idGroups: [],
  nodes: [
    { id: 'note:s:a.md', kind: 'note', label: 'a', path: '/n/a.md' },
    { id: 'note:s:b c.md', kind: 'note', label: 'b c', path: '/n/b c.md' },
    { id: 'todo:x', kind: 'todo', label: 'Fix login' },
  ],
  edges: [
    { id: '1', source: 'note:s:a.md', target: 'todo:x', kind: 'suggested', strength: 0.3, reasons: [] },
    { id: '2', source: 'todo:x', target: 'note:s:b c.md', kind: 'explicit', strength: 0.9, reasons: [] },
  ],
};

describe('handle with Claude', () => {
  it('quotes paths with spaces', () => {
    expect(atPath('/n/a.md')).toBe('@/n/a.md');
    expect(handlePrompt('Handle this note.', '/n/b c.md')).toBe('Handle this note.\n\n@"/n/b c.md"');
  });

  it('a note is handled as itself, a to-do through its strongest note', () => {
    expect(handleTarget(snap, snap.nodes[0]!)).toEqual({ notePath: '/n/a.md' });
    expect(handleTarget(snap, snap.nodes[2]!)).toEqual({ notePath: '/n/b c.md', todo: 'Fix login' });
    expect(handleTarget(snap, { id: 'tag:x', kind: 'tag', label: 'x' })).toBeNull();
  });
});
