import { describe, expect, it, vi } from 'vitest';
import type { NoteFile } from '../../src/shared/api/types';
import { noteReaders } from './note-open';

describe('noteReaders', () => {
  const note = { text: 'x', bom: false, mtime: 1 } as NoteFile;
  const setup = () => {
    const deps = {
      notePath: (p: string) => (p.endsWith('.md') ? `/root/${p}` : null),
      read: vi.fn(() => note),
      watch: vi.fn(),
      opened: vi.fn(async () => undefined),
    };
    return { deps, r: noteReaders(deps) };
  };

  it("the editor's open watches the note and records it as seen", () => {
    const { deps, r } = setup();
    expect(r.open('a.md')).toBe(note);
    expect(deps.watch).toHaveBeenCalledWith('/root/a.md');
    expect(deps.opened).toHaveBeenCalledWith('/root/a.md', note);
  });

  it('a plain read (table cell, link mention, conflict re-read) neither watches nor marks seen', () => {
    const { deps, r } = setup();
    expect(r.read('a.md')).toBe(note);
    expect(deps.watch).not.toHaveBeenCalled();
    expect(deps.opened).not.toHaveBeenCalled();
  });

  it('refuses paths outside the enabled sources', () => {
    const { deps, r } = setup();
    expect(r.open('x.txt')).toBeNull();
    expect(r.read('x.txt')).toBeNull();
    expect(deps.read).not.toHaveBeenCalled();
  });
});
