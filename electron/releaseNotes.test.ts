import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseLastSeen, readLastSeen, releaseNotesState, usedBefore, writeLastSeen } from './releaseNotes';

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-notes-'));
  file = path.join(dir, 'release-notes.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('release notes state', () => {
  it('parses defensively', () => {
    expect(parseLastSeen('{"lastSeenVersion":"0.2.0"}')).toBe('0.2.0');
    expect(parseLastSeen('{"lastSeenVersion":3}')).toBeNull();
    expect(parseLastSeen('garbage')).toBeNull();
  });

  it('a fresh install records the version and shows nothing', () => {
    expect(releaseNotesState('0.2.0', false, file)).toEqual({
      current: '0.2.0',
      lastSeen: null,
      fresh: true,
    });
    expect(readLastSeen(file)).toBe('0.2.0');
  });

  it('an install from before release notes has no record but is not fresh', () => {
    expect(releaseNotesState('0.2.0', true, file)).toEqual({
      current: '0.2.0',
      lastSeen: null,
      fresh: false,
    });
    expect(readLastSeen(file)).toBeNull();
  });

  it('reports the recorded version and never moves it backwards', () => {
    writeLastSeen('0.3.0', file);
    writeLastSeen('0.2.0', file);
    expect(releaseNotesState('0.4.0', true, file)).toEqual({
      current: '0.4.0',
      lastSeen: '0.3.0',
      fresh: false,
    });
  });

  it('earlier use = app state in the folder', () => {
    expect(usedBefore(dir)).toBe(false);
    fs.writeFileSync(path.join(dir, 'state.json'), '{}');
    expect(usedBefore(dir)).toBe(true);
  });
});
