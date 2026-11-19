import { describe, expect, it } from 'vitest';
import { pathsInput, shellQuote } from './paths';
import { assignLabels, findMatches, makeLabels, resolveLabel } from './quickSelect';

describe('paths', () => {
  it('escapes like Terminal.app drag and drop', () => {
    expect(shellQuote('/Users/me/Screen Shot (1).png')).toBe('/Users/me/Screen\\ Shot\\ \\(1\\).png');
    expect(shellQuote("/tmp/it's")).toBe("/tmp/it\\'s");
    expect(shellQuote('/tmp/스크린샷.png')).toBe('/tmp/스크린샷.png');
  });
  it('joins with spaces and ends with one', () => {
    expect(pathsInput(['/a b', '/c'])).toBe('/a\\ b /c ');
    expect(pathsInput([])).toBe('');
    expect(pathsInput([''])).toBe('');
  });
});

const texts = (line: string) => findMatches(line).map((m) => `${m.kind}:${m.text}`);

describe('findMatches', () => {
  it('finds URLs without trailing punctuation', () => {
    expect(texts('See https://example.com/a?b=1, then (https://x.dev/y).')).toEqual([
      'url:https://example.com/a?b=1',
      'url:https://x.dev/y',
    ]);
    expect(texts('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
      'url:https://en.wikipedia.org/wiki/Foo_(bar)',
    ]);
  });

  it('finds paths with line numbers and bare file names', () => {
    expect(texts('Edited src/app/main.ts:12:3 and ./x/y.')).toEqual([
      'path:src/app/main.ts:12:3',
      'path:./x/y',
    ]);
    expect(texts('~/Desktop/a and /usr/local/bin')).toEqual(['path:~/Desktop/a', 'path:/usr/local/bin']);
    expect(texts('Update README.md and package.json:4')).toEqual(['path:README.md', 'path:package.json:4']);
  });

  it('skips prose that only looks like a file', () => {
    expect(texts('e.g. this, i.e. that, v1.2.3, 3.14')).toEqual([]);
  });

  it('finds commit hashes but not numbers or hex words', () => {
    expect(texts('commit 7244cbc merged; 1234567 rows; defaced')).toEqual(['hash:7244cbc']);
  });

  it('does not report a path inside a URL', () => {
    expect(texts('open https://github.com/a/b/pull/27')).toEqual(['url:https://github.com/a/b/pull/27']);
  });

  it('gives offsets into the line', () => {
    const [m] = findMatches('  go: src/x.ts');
    expect(m).toMatchObject({ start: 6, end: 14 });
  });
});

describe('labels', () => {
  it('one letter up to 26 targets, then two (prefix-free)', () => {
    expect(makeLabels(3)).toEqual(['a', 's', 'd']);
    const many = makeLabels(30);
    expect(many).toHaveLength(30);
    expect(many.every((l) => l.length === 2)).toBe(true);
    expect(new Set(many).size).toBe(30);
  });

  it('labels from the bottom up and shares a label between equal texts', () => {
    const m = assignLabels([{ text: 'top' }, { text: 'dup' }, { text: 'bottom' }, { text: 'dup' }]);
    expect(m.get('dup')).toBe('a');
    expect(m.get('bottom')).toBe('s');
    expect(m.get('top')).toBe('d');
  });

  it('resolves typed prefixes', () => {
    const labels = ['aa', 'as', 'sa'];
    expect(resolveLabel('a', labels)).toBe('partial');
    expect(resolveLabel('as', labels)).toBe('as');
    expect(resolveLabel('x', labels)).toBe('none');
  });
});
