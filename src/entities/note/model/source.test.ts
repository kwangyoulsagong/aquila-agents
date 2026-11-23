import { describe, expect, it } from 'vitest';
import { translator } from '@/shared/i18n';
import { sourceDot, sourceLine, sourceName } from './source';

const t = translator('en');
const base = { id: 'a', path: '~/Notes/Meetings', enabled: true, notes: 3 };

describe('note sources', () => {
  it('names a source by its folder', () => {
    expect(sourceName('~/Notes/Meetings/')).toBe('Meetings');
    expect(sourceName('C:\\notes')).toBe('notes');
  });

  it('a dot and a line per state', () => {
    expect(sourceDot('indexing')).toBe('working');
    expect(sourceDot('paused')).toBe('waiting');
    expect(sourceLine(t, { ...base, state: 'ready' })).toBe('3 notes');
    expect(sourceLine(t, { ...base, state: 'indexing', total: 10 })).toBe('Indexing… 3 / 10');
    expect(sourceLine(t, { ...base, state: 'paused', total: 900 })).toBe('Paused in power saver · 900 files');
    expect(sourceLine(t, { ...base, state: 'off' })).toBe('Off · not indexed');
  });
});
