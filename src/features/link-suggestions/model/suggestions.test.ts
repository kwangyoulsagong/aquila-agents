import { describe, expect, it } from 'vitest';
import type { GraphSnapshot } from '@/shared/api';
import { translator } from '@/shared/i18n';
import { patternLabel, suggestionsFor } from './suggestions';

const t = translator('en');
const SNAP: GraphSnapshot = {
  version: 1,
  idGroups: [],
  nodes: [
    { id: 'note:s:meeting.md', kind: 'note', label: 'Planning', path: '/n/meeting.md' },
    { id: 'note:s:spec.md', kind: 'note', label: 'Printable reports', path: '/n/spec.md' },
    { id: 'note:s:bug.md', kind: 'note', label: 'Import crash', path: '/n/bug.md' },
    { id: 'note:s:memo.md', kind: 'note', label: 'Memo', path: '/n/memo.md' },
    { id: 'person:mina', kind: 'person', label: 'Mina' },
  ],
  edges: [
    {
      id: 'a',
      source: 'note:s:meeting.md',
      target: 'note:s:spec.md',
      kind: 'suggested',
      strength: 0.2,
      reasons: [{ via: 'similar', label: 'footer, margins' }],
    },
    {
      id: 'b',
      source: 'note:s:bug.md',
      target: 'note:s:meeting.md',
      kind: 'mention',
      strength: 0.7,
      reasons: [{ via: 'id', label: 'DB-31' }],
    },
    {
      id: 'c',
      source: 'note:s:meeting.md',
      target: 'person:mina',
      kind: 'suggested',
      strength: 0.3,
      reasons: [{ via: 'ai', label: 'person' }],
    },
    {
      id: 'd',
      source: 'note:s:meeting.md',
      target: 'note:s:memo.md',
      kind: 'explicit',
      strength: 1,
      reasons: [{ via: 'link' }],
    },
  ],
};

describe('suggestionsFor', () => {
  it('lists suggested and found-in-text connections, strongest first, never written links', () => {
    const list = suggestionsFor(t, SNAP, 'note:s:meeting.md');
    expect(list.map((s) => [s.other.label, s.line, s.why])).toEqual([
      ['Import crash', 'dashed', 'Same ID DB-31'],
      ['Mina', 'dotted', 'AI: person mentioned'],
      ['Printable reports', 'dotted', 'Shared words: footer, margins'],
    ]);
    // Only note ↔ note can get a written [[link]], named after the file.
    expect(list.map((s) => s.linkName)).toEqual(['bug', undefined, 'spec']);
  });

  it('nothing for an unknown node or no snapshot', () => {
    expect(suggestionsFor(t, SNAP, 'note:s:nope.md')).toEqual([]);
    expect(suggestionsFor(t, null, 'note:s:meeting.md')).toEqual([]);
  });

  it('labels patterns', () => {
    expect(patternLabel({ kind: 'id', prefix: 'DB' })).toBe('DB-<n>');
    expect(patternLabel({ kind: 'url', host: 'github.com' })).toBe('github.com');
  });
});
