import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '@/shared/api';
import { linkOptions, linksTo, outline, resolveLink } from './links';

const snap: GraphSnapshot = {
  version: 1,
  idGroups: [],
  nodes: [
    { id: 'note:a:spec.md', kind: 'note', label: 'Session restore', sourceId: 'a', path: '/n/a/spec.md' },
    { id: 'note:a:meet.md', kind: 'note', label: 'Weekly sync', sourceId: 'a', path: '/n/a/meet.md' },
    { id: 'note:b:memo.md', kind: 'note', label: 'Memo', sourceId: 'b', path: '/n/b/memo.md' },
    { id: 'note:b:spec.md', kind: 'note', label: 'Other spec', sourceId: 'b', path: '/n/b/spec.md' },
    { id: 'tag:x', kind: 'tag', label: '#x' },
  ],
  edges: [
    { id: '1', source: 'note:a:meet.md', target: 'note:a:spec.md', kind: 'explicit', strength: 1, reasons: [{ via: 'link', label: 'Plan' }] },
    { id: '2', source: 'note:b:memo.md', target: 'note:a:spec.md', kind: 'mention', strength: 0.6, reasons: [{ via: 'title', label: 'Session restore' }] },
    { id: '3', source: 'note:b:memo.md', target: 'note:a:spec.md', kind: 'mention', strength: 0.5, reasons: [{ via: 'id', label: 'DB-12' }] },
    { id: '4', source: 'note:a:spec.md', target: 'tag:x', kind: 'explicit', strength: 1, reasons: [{ via: 'tag' }] },
  ],
};

describe('outline', () => {
  it('lists ATX headings, skipping frontmatter and code', () => {
    const text = ['---', '# not', '---', '# Title', '```', '## no', '```', '## Plan ##', 'text'].join('\r\n');
    expect(outline(text)).toEqual([
      { level: 1, text: 'Title', line: 4 },
      { level: 2, text: 'Plan', line: 8 },
    ]);
  });
});

describe('linksTo', () => {
  it('splits written links from unlinked title mentions', () => {
    const { backlinks, mentions } = linksTo(snap, 'note:a:spec.md');
    expect(backlinks).toEqual([{ id: 'note:a:meet.md', label: 'Weekly sync', path: '/n/a/meet.md', detail: 'Plan' }]);
    expect(mentions.map((m) => m.id)).toEqual(['note:b:memo.md']);
  });
});

describe('resolveLink', () => {
  it('resolves by file name (same source first), then title, then path suffix', () => {
    expect(resolveLink(snap, 'spec', 'b')?.id).toBe('note:b:spec.md');
    expect(resolveLink(snap, 'spec', 'a')?.id).toBe('note:a:spec.md');
    expect(resolveLink(snap, 'Weekly sync#Plan|sync')?.id).toBe('note:a:meet.md');
    expect(resolveLink(snap, 'b/memo')?.id).toBe('note:b:memo.md');
    expect(resolveLink(snap, 'nothing')).toBeUndefined();
  });
});

describe('linkOptions', () => {
  it('offers every other note, inserting the file name', () => {
    const opts = linkOptions(snap, '/n/a/spec.md');
    expect(opts).toContainEqual({ insert: 'meet', label: 'Weekly sync', detail: 'meet' });
    expect(opts.some((o) => o.label === 'Session restore')).toBe(false);
    expect(opts).toHaveLength(3);
  });
});
