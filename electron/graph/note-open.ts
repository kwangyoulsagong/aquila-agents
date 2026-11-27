// Reading a note for the editor vs. for a helper. Only the editor's real open watches the file and gives it a "seen"
// baseline (T80); a table cell edit, a link-mention splice or the editor's conflict re-read only reads — a note the
// user never opened must not look seen.
import type { NoteFile } from '../../src/shared/api/types';

export interface NoteReaderDeps {
  /** The absolute path of a note of an enabled source, else null. */
  notePath: (p: string) => string | null;
  read: (file: string) => NoteFile | null;
  watch: (file: string) => void;
  opened: (file: string, note: NoteFile) => Promise<void>;
}

export function noteReaders(deps: NoteReaderDeps) {
  const read = (p: string) => {
    const file = deps.notePath(String(p));
    return { file, note: file ? deps.read(file) : null };
  };
  return {
    /** The editor opened it: watch it until `noteClose`, record what the user saw. */
    open(p: string): NoteFile | null {
      const { file, note } = read(p);
      if (file && note) {
        deps.watch(file);
        void deps.opened(file, note).catch(() => undefined);
      }
      return note;
    },
    /** A plain read: no watch, no seen state. */
    read(p: string): NoteFile | null {
      return read(p).note;
    },
  };
}
