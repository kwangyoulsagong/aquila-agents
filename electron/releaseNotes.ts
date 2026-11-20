// Release notes (T27): the last version whose notes were shown, in ~/.aquila/release-notes.json. The notes themselves
// are bundled with the renderer (release-notes/*.json); main only knows versions. Smoke never reads or writes it.
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from './config';
import type { ReleaseNotesState } from '../src/shared/api/types';
import { compareVersions } from '../src/features/release-notes/model/notes';

export const RELEASE_NOTES_PATH = path.join(APP_DIR, 'release-notes.json');

/** Defensive parse: anything unexpected means "no record". */
export function parseLastSeen(text: string): string | null {
  try {
    const raw: unknown = JSON.parse(text);
    const v =
      raw && typeof raw === 'object' ? (raw as { lastSeenVersion?: unknown }).lastSeenVersion : undefined;
    return typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function readLastSeen(file = RELEASE_NOTES_PATH): string | null {
  try {
    return parseLastSeen(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Temp file + rename. Never moves the record backwards (an older build launched once). */
export function writeLastSeen(version: string, file = RELEASE_NOTES_PATH): void {
  const prev = readLastSeen(file);
  if (prev && compareVersions(prev, version) >= 0) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ lastSeenVersion: version }, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * `usedBefore`: ~/.aquila had app state before this launch (an install from before release notes existed). Without a
 * record and without earlier use this is a fresh install: record the version, show nothing (the guide is offered after
 * the first-run checklist instead).
 */
export function releaseNotesState(
  current: string,
  usedBefore: boolean,
  file = RELEASE_NOTES_PATH,
): ReleaseNotesState {
  const lastSeen = readLastSeen(file);
  if (lastSeen) return { current, lastSeen, fresh: false };
  if (usedBefore) return { current, lastSeen: null, fresh: false };
  writeLastSeen(current, file);
  return { current, lastSeen: null, fresh: true };
}

/** Whether ~/.aquila holds state from an earlier launch. Call before this launch writes anything. */
export function usedBefore(dir = APP_DIR): boolean {
  return ['state.json', 'guide.json', 'release-notes.json'].some((f) => fs.existsSync(path.join(dir, f)));
}
