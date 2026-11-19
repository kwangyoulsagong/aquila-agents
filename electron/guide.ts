// In-app guide (T23): whether the "Take a tour" offer after the first-run checklist was shown already.
// State in ~/.aquila/guide.json. Smoke never reads or writes it.
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR } from './config';
import type { GuideState } from '../src/shared/api/types';

export const GUIDE_PATH = path.join(APP_DIR, 'guide.json');

/** Defensive parse: anything unexpected means "not offered yet", never a throw. */
export function parseGuideState(text: string): GuideState {
  try {
    const raw: unknown = JSON.parse(text);
    return { offered: !!raw && typeof raw === 'object' && (raw as { offered?: unknown }).offered === true };
  } catch {
    return { offered: false };
  }
}

export function readGuideState(file = GUIDE_PATH): GuideState {
  try {
    return parseGuideState(fs.readFileSync(file, 'utf8'));
  } catch {
    return { offered: false };
  }
}

/** Temp file + rename, so a crash never leaves half a file. */
export function markGuideOffered(file = GUIDE_PATH): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...readGuideState(file), offered: true }, null, 2));
  fs.renameSync(tmp, file);
}
