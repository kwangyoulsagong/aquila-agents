import { describe, expect, it } from 'vitest';
import { codeish, normalizeUrl, parseFrontmatter, parseNote } from './parse';

describe('parseFrontmatter', () => {
  it('reads scalars, inline lists, dash lists and keeps nested maps raw', () => {
    const { data, body } = parseFrontmatter(
      [
        '---',
        'title: "Login spec"',
        'tags: [auth, "ui"]',
        'owners:',
        '  - Kim',
        '  - Lee',
        'meta:',
        '  a: 1',
        'link: "[[Other]]"',
        '---',
        'Body',
      ].join('\n'),
    );
    expect(data).toEqual({
      title: 'Login spec',
      tags: ['auth', 'ui'],
      owners: ['Kim', 'Lee'],
      meta: 'a: 1',
      link: '[[Other]]',
    });
    expect(body).toBe('Body');
  });

  it('leaves text without frontmatter alone', () => {
    expect(parseFrontmatter('# Hi\n---\n')).toEqual({ data: {}, body: '# Hi\n---\n' });
  });
});

describe('parseNote', () => {
  it('finds wiki links with alias and heading, relative md links and URLs', () => {
    const n = parseNote(
      'a.md',
      [
        'See [[Login spec#API|the API]] and [[notes/Daily.md]] and ![[diagram.png]].',
        '[spec](../specs/login%20spec.md#flow) [site](https://Example.com/a/#x). [img](pic.png)',
        'Raw: https://github.com/o/r/issues/1.',
      ].join('\n'),
    );
    expect(n.wikiLinks).toEqual([
      { target: 'Login spec', heading: 'API', alias: 'the API' },
      { target: 'notes/Daily' },
      { target: 'diagram.png' },
    ]);
    expect(n.mdLinks).toEqual(['../specs/login spec.md']);
    expect(n.urls).toEqual(['https://example.com/a', 'https://github.com/o/r/issues/1']);
  });

  it('reads tags outside code, not issue numbers or headings', () => {
    const n = parseNote(
      'a.md',
      [
        '## Heading',
        'Done #release #12 #한글태그 (#ui/button)',
        '`#notatag`',
        '```',
        '#include <x>',
        '```',
      ].join('\n'),
    );
    expect(n.tags).toEqual(['release', '한글태그', 'ui/button']);
    expect(n.headings).toEqual([{ level: 2, text: 'Heading' }]);
  });

  it('takes tags and references from frontmatter', () => {
    const n = parseNote('a.md', '---\ntags: a, b\nowner: Kim\nspec: "[[Login]]"\n---\n#c');
    expect(n.tags).toEqual(['c', 'a', 'b']);
    expect(n.frontmatterRefs).toEqual([
      { key: 'owner', value: 'Kim' },
      { key: 'spec', value: 'Login' },
    ]);
  });

  it('finds ID-like tokens in text and frontmatter, not versions', () => {
    const n = parseNote('a.md', '---\nid: PROJ-104\n---\nFix DB-12에서 본 버그, UTF-8 and SHA-256, ES2022.');
    expect(n.ids.sort()).toEqual(['DB-12', 'PROJ-104']);
  });

  it('T79: keeps compound ID prefixes, frontmatter id and status', () => {
    const n = parseNote(
      'a.md',
      '---\nid: FE-REQ-030\nstatus: draft\n---\nSee SRV-REQ-040 and DB-6891, not UTF-8.\n```\nCODE-1\n```',
    );
    expect(n.refIds.sort()).toEqual(['DB-6891', 'FE-REQ-030', 'SRV-REQ-040']);
    expect(n.fmId).toBe('FE-REQ-030');
    expect(n.status).toBe('draft');
    expect(parseNote('b.md', 'x').fmId).toBeUndefined();
  });

  it('finds code-ish names in text, inline code and code blocks', () => {
    const n = parseNote(
      'a.md',
      'The `useWorkspace` hook calls parse_note in apply.ts.\n```\nplanRestore()\n```\nindex',
    );
    expect(n.idents.sort()).toEqual(['apply.ts', 'parse_note', 'planRestore', 'useWorkspace']);
  });

  it('titles: frontmatter title, then the first H1, then the file name', () => {
    expect(parseNote('x.md', '---\ntitle: T\n---\n# H').title).toBe('T');
    expect(parseNote('x.md', 'intro\n# H1\n## H2').title).toBe('H1');
    expect(parseNote('2026-11-20 sync.md', 'text').title).toBe('2026-11-20 sync');
  });

  it('keeps a lowercased body without frontmatter', () => {
    expect(parseNote('x.md', '---\na: B\n---\nHello World').text).toBe('hello world');
  });
});

describe('codeish', () => {
  it('accepts camel/Pascal humps, snake_case and code files; not plain words', () => {
    for (const s of ['useWorkspace', 'SessionTabs', 'HTMLElement', 'parse_note', 'apply.ts', 'tokens.css'])
      expect(codeish(s), s).toBe(true);
    for (const s of ['index', 'Login', 'README', 'abc', 'DB_', 'a.ts']) expect(codeish(s), s).toBe(false);
  });
});

describe('normalizeUrl', () => {
  it('drops hash, trailing slash and prose punctuation; refuses other schemes', () => {
    expect(normalizeUrl('https://A.com/x/#h.')).toBe('https://a.com/x');
    expect(normalizeUrl('ftp://a.com')).toBe(null);
  });
});
