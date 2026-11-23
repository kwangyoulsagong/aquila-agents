import { Text, type ChangeSet } from '@codemirror/state';

// Byte-for-byte saving. CodeMirror keeps a document as lines and would join them back with one separator, so a
// CRLF or mixed-ending file would change on every line. Instead the editor keeps the file's text as read and the
// changes made since (composed into one ChangeSet), and a save applies only those changes to the original string:
// untouched lines — their endings, trailing spaces, everything — are copied as they were.

const SPLIT = /\r\n?|\n/;

/** The document CodeMirror builds from a file (same split as its default: `\r\n`, `\r`, `\n`). */
export function docOf(original: string): Text {
  return Text.of(original.split(SPLIT));
}

/** The first line ending in the file, used for lines the user adds; `\n` when there is none. */
export function lineSeparator(original: string): string {
  return /\r\n?|\n/.exec(original)?.[0] ?? '\n';
}

/** Start of each line in the original string (`starts[i]` = offset of line i + 1). */
function lineStarts(original: string): number[] {
  const starts = [0];
  const re = /\r\n?|\n/g;
  for (let m = re.exec(original); m; m = re.exec(original)) starts.push(m.index + m[0].length);
  return starts;
}

/**
 * `original` with `changes` (made on `docOf(original)`) applied. No changes → `original`, unchanged. Inserted
 * line breaks use the file's own ending.
 */
export function applyChanges(original: string, changes: ChangeSet): string {
  if (changes.empty) return original;
  const doc = docOf(original);
  const starts = lineStarts(original);
  const sep = lineSeparator(original);
  const at = (pos: number) => {
    const line = doc.lineAt(pos);
    return starts[line.number - 1]! + (pos - line.from);
  };
  const parts: string[] = [];
  let last = 0;
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const from = at(fromA);
    parts.push(original.slice(last, from), inserted.sliceString(0, inserted.length, sep));
    last = at(toA);
  });
  parts.push(original.slice(last));
  return parts.join('');
}
