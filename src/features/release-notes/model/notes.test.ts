import { describe, expect, it } from 'vitest';
import { ALL_NOTES, notesFrom } from './bundle';
import { compareVersions, draftNotes, parseCommit, parseNotes, TODO, unseenNotes, type ReleaseNotes } from './notes';

const headline = (id: string) => ({
  guideId: id,
  title: { ko: `${id} 제목`, en: `${id} title` },
  body: { ko: `${id} 본문`, en: `${id} body` },
});
const raw = (version: string, n = 3) => ({
  version,
  date: '2026-11-20',
  headlines: Array.from({ length: n }, (_, i) => headline(`item${i}`)),
});
const notes = (version: string) => parseNotes(raw(version)).notes as ReleaseNotes;

describe('compareVersions', () => {
  it('compares numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.2.0', '0.2.1')).toBeLessThan(0);
    expect(compareVersions('0.2.0-beta.1', '0.2.0')).toBe(0);
  });
});

describe('parseNotes', () => {
  it('accepts complete ko + en notes', () => {
    const r = parseNotes(raw('0.2.0'), '0.2.0');
    expect(r.errors).toEqual([]);
    expect(r.notes?.headlines).toHaveLength(3);
  });

  it('rejects a missing language, TODOs, a wrong version and too few or many headlines', () => {
    const bad = raw('0.2.0');
    bad.headlines[0].title.ko = '';
    bad.headlines[1].body.en = TODO;
    const r = parseNotes(bad, '0.3.0');
    expect(r.notes).toBeUndefined();
    expect(r.errors.join('\n')).toMatch(/title\.ko is missing/);
    expect(r.errors.join('\n')).toMatch(/body\.en still says TODO/);
    expect(r.errors.join('\n')).toMatch(/doesn't match the file name/);
    expect(parseNotes(raw('0.2.0', 2)).errors[0]).toMatch(/2 headlines/);
    expect(parseNotes(raw('0.2.0', 6)).errors[0]).toMatch(/6 headlines/);
    expect(parseNotes('nope').errors).toEqual(['not a JSON object']);
  });
});

describe('unseenNotes', () => {
  const all = ['0.1.0', '0.2.0', '0.3.0', '0.4.0'].map(notes);

  it('combines every version after the last seen one, up to the running one, newest first', () => {
    expect(unseenNotes(all, '0.1.0', '0.3.0').map((n) => n.version)).toEqual(['0.3.0', '0.2.0']);
  });

  it('shows nothing when nothing is newer', () => {
    expect(unseenNotes(all, '0.4.0', '0.4.0')).toEqual([]);
  });

  it('shows only the running version when there is no record', () => {
    expect(unseenNotes(all, null, '0.2.0').map((n) => n.version)).toEqual(['0.2.0']);
  });
});

describe('drafts', () => {
  it('parses Conventional Commit subjects', () => {
    expect(parseCommit('feat(split): add zoom')).toEqual({ type: 'feat', scope: 'split', text: 'add zoom' });
    expect(parseCommit('fix!: breaking')).toEqual({ type: 'fix', text: 'breaking' });
    expect(parseCommit('Merge pull request #1')).toBeNull();
  });

  it('drafts one headline per feat with TODOs left, which the check rejects', () => {
    const d = draftNotes(['feat(a): first thing', 'fix: x', 'chore: y'], '0.3.0', '2026-11-20');
    expect(d.headlines).toHaveLength(3); // padded to the minimum
    expect(d.headlines[0].title.en).toBe('First thing');
    expect(parseNotes(d, '0.3.0').notes).toBeUndefined();
  });
});

describe('bundled notes', () => {
  it('skips invalid files and sorts newest first', () => {
    const r = notesFrom({
      '/release-notes/0.1.0.json': raw('0.1.0'),
      '/release-notes/0.2.0.json': raw('0.2.0'),
      '/release-notes/0.3.0.json': raw('0.2.0'), // name and version disagree
    });
    expect(r.map((n) => n.version)).toEqual(['0.2.0', '0.1.0']);
  });

  it('every file in release-notes/ is valid and the running version has notes', async () => {
    const files = import.meta.glob('/release-notes/*.json');
    expect(ALL_NOTES).toHaveLength(Object.keys(files).length);
    const { version } = (await import('../../../../package.json')).default as { version: string };
    expect(ALL_NOTES.some((n) => n.version === version)).toBe(true);
  });
});
