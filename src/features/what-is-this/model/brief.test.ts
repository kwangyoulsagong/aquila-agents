import { describe, expect, it } from 'vitest';
import { translator } from '@/shared/i18n';
import type { BriefFields, RelatedNote } from '@/shared/api';
import { checkFile, defaultTitle, isEmpty, MAX_FILE_BYTES, MAX_PDF_BYTES, termIds, whyLabel } from './brief';

const fields = (over: Partial<BriefFields> = {}): BriefFields => ({
  product: '',
  feature: '',
  intent: '',
  points: [],
  questions: [],
  terms: [],
  ...over,
});

describe('checkFile', () => {
  it('reads text files and PDFs; binaries are unsupported; big files refused', () => {
    expect(checkFile('guide.md', '', 10)).toEqual({ ok: true, pdf: false });
    expect(checkFile('mail.eml', 'message/rfc822', 10)).toEqual({ ok: true, pdf: false });
    expect(checkFile('notes', 'text/plain', 10)).toEqual({ ok: true, pdf: false });
    expect(checkFile('spec.pdf', 'application/pdf', 10)).toEqual({ ok: true, pdf: true });
    expect(checkFile('scan', 'application/pdf', MAX_FILE_BYTES + 1)).toEqual({ ok: true, pdf: true });
    expect(checkFile('huge.pdf', '', MAX_PDF_BYTES + 1)).toEqual({ ok: false, reason: 'tooBig' });
    expect(checkFile('shot.png', 'image/png', 10)).toEqual({ ok: false, reason: 'unsupported' });
    expect(checkFile('big.txt', 'text/plain', MAX_FILE_BYTES + 1)).toEqual({ ok: false, reason: 'tooBig' });
  });
});

describe('card helpers', () => {
  const t = translator('en');
  const rel = (ids: string[], words: string[]): RelatedNote => ({
    path: '/n/a.md',
    title: 'A',
    sourceId: 's',
    ids,
    words,
    score: 1,
  });

  it('says why a note is related', () => {
    expect(whyLabel(rel(['REQ-030'], ['login', 'token']), t)).toBe(
      'same ID REQ-030 · shared words: login, token',
    );
    expect(whyLabel(rel([], ['archive']), t)).toBe('shared words: archive');
    expect(whyLabel(rel(['A-1'], []), translator('ko'))).toBe('같은 ID A-1');
  });

  it('IDs among the terms', () => {
    expect(termIds(fields({ terms: ['FE-REQ-030', 'remember me', 'db-12'] }))).toEqual([
      'FE-REQ-030',
      'db-12',
    ]);
    expect(termIds(null)).toEqual([]);
  });

  it('a title from product and feature, else the label, else the date', () => {
    const d = new Date(2026, 10, 27);
    expect(defaultTitle(fields({ product: 'Aquila', feature: 'Login / SSO' }), '', d)).toBe(
      'Aquila — Login SSO',
    );
    expect(defaultTitle(null, 'https://figma.com/design/x', d)).toBe('figma.com design x');
    expect(defaultTitle(null, '', d)).toBe('Brief 2026-11-27');
  });

  it('an empty card', () => {
    expect(isEmpty(fields())).toBe(true);
    expect(isEmpty(fields({ terms: ['x'] }))).toBe(false);
  });
});
