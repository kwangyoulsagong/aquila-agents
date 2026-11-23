import { ChangeSet, EditorState, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { applyChanges, docOf, lineSeparator } from './serialize';

// Every Markdown fixture of the graph and the editor, as text (the byte-level BOM / UTF-8 checks are in
// electron/graph/note-file.test.ts).
const fixtures = import.meta.glob('../../../../electron/fixtures/{graph,notes}/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Opens `original` in an editor state, runs the edits, returns what a save writes. */
function edit(original: string, ...specs: ((s: EditorState) => TransactionSpec)[]) {
  let state = EditorState.create({ doc: docOf(original) });
  let acc = ChangeSet.empty(state.doc.length);
  for (const spec of specs) {
    const tr = state.update(spec(state));
    acc = acc.compose(tr.changes);
    state = tr.state;
  }
  return { saved: applyChanges(original, acc), state };
}

describe('applyChanges', () => {
  it('round-trips every fixture unchanged when nothing is edited', () => {
    const names = Object.keys(fixtures);
    expect(names.length).toBeGreaterThanOrEqual(6);
    for (const name of names) expect(edit(fixtures[name]!).saved, name).toBe(fixtures[name]);
  });

  it('round-trips every fixture after an edit that is undone by hand', () => {
    for (const [name, text] of Object.entries(fixtures)) {
      const { saved } = edit(
        text,
        () => ({ changes: { from: 0, insert: 'x' } }),
        () => ({ changes: { from: 0, to: 1 } }),
      );
      expect(saved, name).toBe(text);
    }
  });

  it('keeps CRLF on untouched lines and uses it for new ones', () => {
    const original = 'a\r\nb\r\nc\r\n';
    const { saved } = edit(original, (s) => ({ changes: { from: s.doc.line(2).to, insert: '\nB' } }));
    expect(saved).toBe('a\r\nb\r\nB\r\nc\r\n');
  });

  it('changes only the edited range of a mixed-ending file', () => {
    const original = 'one\r\ntwo  \nthree\rfour';
    const { saved } = edit(original, (s) => ({ changes: { from: s.doc.line(3).from, to: s.doc.line(3).to, insert: '3' } }));
    expect(saved).toBe('one\r\ntwo  \n3\rfour');
  });

  it('maps deletions across line breaks to the original offsets', () => {
    const original = 'ab\r\ncd\r\nef';
    // Delete from after "a" to after "c": "a" + "d\r\nef".
    const { saved } = edit(original, () => ({ changes: { from: 1, to: 4 } }));
    expect(saved).toBe('ad\r\nef');
  });

  it('toggles a checkbox in a CRLF table note by one character', () => {
    const original = fixtures['../../../../electron/fixtures/notes/crlf-table.md']!;
    const at = docOf(original).toString().indexOf('- [ ] ') + 3;
    const { saved } = edit(original, () => ({ changes: { from: at, to: at + 1, insert: 'x' } }));
    expect(saved.length).toBe(original.length);
    expect([...saved].filter((c, i) => c !== original[i])).toEqual(['x']);
  });

  it('detects the file line ending', () => {
    expect(lineSeparator('a\r\nb\nc')).toBe('\r\n');
    expect(lineSeparator('a')).toBe('\n');
  });
});
