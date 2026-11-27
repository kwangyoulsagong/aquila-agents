import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '@/shared/api';
import { sameSnapshot } from './useGraphData';

const snap = (label: string, version: number): GraphSnapshot => ({
  nodes: [{ id: 'note:s:a.md', kind: 'note', label, mtime: 1 }],
  edges: [],
  idGroups: [],
  version,
});

describe('sameSnapshot', () => {
  it('ignores the version, sees any node change', () => {
    expect(sameSnapshot(snap('A', 1), snap('A', 7))).toBe(true);
    expect(sameSnapshot(snap('A', 1), snap('B', 1))).toBe(false);
  });
});
