import { describe, expect, it } from 'vitest';
import type { ApplyStep } from '@/shared/api';
import { draftsOf, keptSteps, stepNodes } from './drafts';

const step = (id: string, nodes: string[] = []): ApplyStep => ({
  id,
  title: `Step ${id}`,
  files: [],
  nodes,
  size: 'S',
  risk: 'low',
});

describe('step drafts', () => {
  it('starts all ticked; keeps ticked steps with rewritten titles', () => {
    const drafts = draftsOf([step('s1'), step('s2'), step('s3')]);
    expect(drafts.every((d) => d.on)).toBe(true);
    drafts[0].on = false;
    drafts[1].title = '  Rewritten  ';
    drafts[2].title = '   ';
    expect(keptSteps(drafts).map((s) => [s.id, s.title])).toEqual([
      ['s2', 'Rewritten'],
      ['s3', 'Step s3'],
    ]);
  });

  it('finds the nodes a hovered step touches', () => {
    const drafts = draftsOf([step('s1', ['h:skills'])]);
    expect(stepNodes(drafts, 's1')).toEqual(['h:skills']);
    expect(stepNodes(drafts, null)).toEqual([]);
    expect(stepNodes(drafts, 'nope')).toEqual([]);
  });
});
