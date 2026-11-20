import { parseNotes, sortNotes, versionOfFile, type ReleaseNotes } from './notes';

/** `release-notes/<version>.json`, bundled (offline). `npm run dist` refuses to package with an invalid one. */
const FILES = import.meta.glob<unknown>('/release-notes/*.json', { eager: true, import: 'default' });

/** Valid notes from a `file → JSON` map, newest first; invalid files are skipped (the release check reports them). */
export function notesFrom(files: Readonly<Record<string, unknown>>): ReleaseNotes[] {
  return sortNotes(
    Object.entries(files).flatMap(([file, raw]) => {
      const { notes } = parseNotes(raw, versionOfFile(file));
      return notes ? [notes] : [];
    }),
  );
}

export const ALL_NOTES: readonly ReleaseNotes[] = notesFrom(FILES);
