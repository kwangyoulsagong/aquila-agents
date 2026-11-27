import { describe, expect, it } from 'vitest';
import { applySplices, codeRanges, linkSplices } from './link-rewrite';

const fix = (text: string, moves: { from: string; to: string }[], noteFrom = 'other.md', noteTo = noteFrom) =>
  applySplices(text, linkSplices(text, noteFrom, noteTo, moves));

describe('wikilinks', () => {
  const rename = [{ from: 'specs/Old name.md', to: 'specs/New name.md' }];
  it('rewrites the target and keeps heading and alias', () => {
    expect(fix('See [[Old name]], [[old name#API|the API]] and [[Old name|alias]].', rename)).toBe(
      'See [[New name]], [[New name#API|the API]] and [[New name|alias]].',
    );
  });
  it('keeps `.md` and spaces as written', () => {
    expect(fix('[[ Old name.md ]]', rename)).toBe('[[ New name.md ]]');
  });
  it('rewrites path-form links, full or a suffix', () => {
    const move = [{ from: 'a/b/Spec.md', to: 'c/Spec.md' }];
    expect(fix('[[a/b/Spec]] [[b/Spec]]', move)).toBe('[[c/Spec]] [[c/Spec]]');
  });
  it('leaves name-only links when only the folder changed', () => {
    expect(fix('[[Spec]]', [{ from: 'a/Spec.md', to: 'b/Spec.md' }])).toBe('[[Spec]]');
  });
  it('leaves other links and code alone', () => {
    const text = 'x [[Other]] `[[Old name]]`\n```\n[[Old name]]\n```\n~~~md\n[[Old name]]\n~~~\n';
    expect(fix(text, rename)).toBe(text);
  });
});

describe('relative Markdown links', () => {
  it('follows a moved target', () => {
    expect(fix('[s](specs/a.md#top) [t](./specs/a.md)', [{ from: 'specs/a.md', to: 'done/a.md' }])).toBe(
      '[s](done/a.md#top) [t](./done/a.md)',
    );
  });
  it('keeps encoding and angle brackets', () => {
    const move = [{ from: 'my spec.md', to: 'archive/my spec.md' }];
    expect(fix('[a](my%20spec.md) [b](<my spec.md>)', move)).toBe(
      '[a](archive/my%20spec.md) [b](<archive/my spec.md>)',
    );
  });
  it('encodes a new space in a bare link (it would stop being a link), keeps Korean readable', () => {
    expect(fix('[x](a/spec.md)', [{ from: 'a/spec.md', to: 'a/스펙 login.md' }])).toBe(
      '[x](a/스펙%20login.md)',
    );
  });
  it("rewrites a moved note's own links to notes that stayed", () => {
    expect(fix('[up](../index.md) [x](https://a.md)', [], 'a/b.md', 'a/c/b.md')).toBe(
      '[up](../../index.md) [x](https://a.md)',
    );
  });
  it('leaves images, external links and unchanged targets', () => {
    const text = '![i](specs/a.md) [w](https://x/specs/a.md) [o](other.md)';
    expect(fix(text, [{ from: 'specs/a.md', to: 'b/a.md' }])).toBe(
      '![i](specs/a.md) [w](https://x/specs/a.md) [o](other.md)',
    );
  });
});

describe("a moved note's own images and files", () => {
  it('re-bases relative images and non-note links against the new folder', () => {
    const text = '![](x.png) ![d](img/a%20b.png "t") [pdf](files/x.pdf) [z](<my file.zip>)\n';
    expect(fix(text, [], 'a/n.md', 'b/c/n.md')).toBe(
      '![](../../a/x.png) ![d](../../a/img/a%20b.png "t") [pdf](../../a/files/x.pdf) [z](<../../a/my file.zip>)\n',
    );
  });
  it('keeps CRLF, URLs, anchors, absolute paths and code as written', () => {
    const text =
      '![](x.png)\r\n![w](https://h/x.png) [a](#top) [r](/abs.pdf) [m](mailto:a@b)\r\n`![](x.png)`\r\n```\r\n![](x.png)\r\n```\r\n';
    expect(fix(text, [], 'n.md', 'sub/n.md')).toBe(
      '![](../x.png)\r\n![w](https://h/x.png) [a](#top) [r](/abs.pdf) [m](mailto:a@b)\r\n`![](x.png)`\r\n```\r\n![](x.png)\r\n```\r\n',
    );
  });
  it('a note that stayed leaves its images and files alone when another note moves', () => {
    const text = '![](x.png) [pdf](files/x.pdf) [n](a.md)';
    expect(fix(text, [{ from: 'a.md', to: 'b/a.md' }], 'n.md')).toBe('![](x.png) [pdf](files/x.pdf) [n](b/a.md)');
  });
});

describe('bytes', () => {
  it('keeps CRLF and everything around the link', () => {
    const text = '# T\r\n\r\nSee [[Old]]  \r\n[m](Old.md)\r\n';
    expect(fix(text, [{ from: 'Old.md', to: 'New.md' }])).toBe('# T\r\n\r\nSee [[New]]  \r\n[m](New.md)\r\n');
  });
  it('finds code ranges in CRLF text', () => {
    const text = 'a\r\n```\r\n[[x]]\r\n```\r\nb `c`';
    expect(codeRanges(text).length).toBe(2);
  });
});
