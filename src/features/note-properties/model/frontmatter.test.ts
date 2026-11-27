import { describe, expect, it } from 'vitest';
import { kindOf, readFrontmatter, removeProp, setProp, validKey } from './frontmatter';

const note = [
  '---',
  'title: Login',
  'status: todo',
  'tags: [a, b]',
  'owner: "Kim, J"',
  '---',
  '',
  '# Login',
  '',
].join('\n');

describe('readFrontmatter', () => {
  it('reads keys, styles and values with offsets', () => {
    const fm = readFrontmatter(note)!;
    expect(fm.entries.map((e) => [e.key, e.style, e.value])).toEqual([
      ['title', 'scalar', 'Login'],
      ['status', 'scalar', 'todo'],
      ['tags', 'flow', ['a', 'b']],
      ['owner', 'scalar', 'Kim, J'],
    ]);
    const e = fm.entries[1]!;
    expect(note.slice(e.from, e.to)).toBe('status: todo');
    expect(fm.entries[3]!.quote).toBe('"');
  });

  it('reads block lists (indented or not), raw nested maps and empty values', () => {
    const src =
      'tags:\n  - x\n  - "y z"\nlist:\n- a\nmeta:\n  a: 1\n  b: 2\nempty:\n'.replace(/^/, '---\n') + '---\n';
    const fm = readFrontmatter(src)!;
    expect(fm.entries.map((e) => [e.key, e.style, e.value])).toEqual([
      ['tags', 'block', ['x', 'y z']],
      ['list', 'block', ['a']],
      ['meta', 'raw', 'a: 1\nb: 2'],
      ['empty', 'scalar', ''],
    ]);
  });

  it('is null without frontmatter or without a closing line', () => {
    expect(readFrontmatter('# Hi\n')).toBeNull();
    expect(readFrontmatter('---\ntitle: x\n')).toBeNull();
    expect(readFrontmatter('---\n---\nbody')!.entries).toEqual([]);
  });
});

describe('setProp', () => {
  it('edits only that key’s line', () => {
    expect(setProp(note, 'status', 'done')).toBe(note.replace('status: todo', 'status: done'));
  });

  it('keeps the quoting style and quotes when a plain value needs it', () => {
    expect(setProp(note, 'owner', 'Lee')).toBe(note.replace('owner: "Kim, J"', 'owner: "Lee"'));
    const single = "---\na: 'it''s'\n---\n";
    expect(readFrontmatter(single)!.entries[0]!.value).toBe("it's");
    expect(setProp(single, 'a', "won't")).toBe("---\na: 'won''t'\n---\n");
    expect(setProp(note, 'status', 'a: b')).toContain('status: "a: b"\n');
    expect(setProp(note, 'status', '[[Spec]]')).toContain('status: "[[Spec]]"\n');
  });

  it('keeps flow and block list styles, with the block’s indent', () => {
    expect(setProp(note, 'tags', ['a', 'c d', 'e,f'])).toBe(
      note.replace('tags: [a, b]', 'tags: [a, c d, "e,f"]'),
    );
    const block = '---\ntags:\n    - x\n    - y\nnext: 1\n---\n';
    expect(setProp(block, 'tags', ['x', 'z', 'w'])).toBe(
      '---\ntags:\n    - x\n    - z\n    - w\nnext: 1\n---\n',
    );
    expect(setProp(block, 'tags', [])).toBe('---\ntags: []\nnext: 1\n---\n');
  });

  it('adds a new key before the closing line', () => {
    expect(setProp(note, 'due', '2025-01-02')).toBe(
      note.replace('owner: "Kim, J"\n', 'owner: "Kim, J"\ndue: 2025-01-02\n'),
    );
    expect(setProp('---\n---\nbody', 'a', ['x'])).toBe('---\na: [x]\n---\nbody');
  });

  it('creates frontmatter at the very top of a note without one', () => {
    expect(setProp('# Hi\n', 'status', 'todo')).toBe('---\nstatus: todo\n---\n# Hi\n');
    expect(setProp('', 'a', 'b')).toBe('---\na: b\n---\n');
    expect(setProp('# Hi\r\nbody', 'a', 'b')).toBe('---\r\na: b\r\n---\r\n# Hi\r\nbody');
  });

  it('keeps CRLF and every untouched byte', () => {
    const crlf = '---\r\ntitle: X  \r\nstatus: todo\r\ntags:\r\n  - a\r\n---\r\nbody  \r\n';
    expect(setProp(crlf, 'status', 'done')).toBe(crlf.replace('status: todo', 'status: done'));
    expect(setProp(crlf, 'tags', ['a', 'b'])).toBe(crlf.replace('  - a\r\n', '  - a\r\n  - b\r\n'));
    expect(setProp(crlf, 'new', 'v')).toBe(crlf.replace('  - a\r\n---', '  - a\r\nnew: v\r\n---'));
  });

  it('returns the same text for the same value and refuses bad keys', () => {
    expect(setProp(note, 'status', 'todo')).toBe(note);
    expect(setProp(note, 'tags', ['a', 'b'])).toBe(note);
    expect(setProp(note, 'a:b', 'x')).toBe(note);
    expect(validKey(' ok key ')).toBe(true);
    expect(validKey('- no')).toBe(false);
  });

  it('writes an empty scalar as a bare key', () => {
    expect(setProp(note, 'status', '')).toBe(note.replace('status: todo', 'status:'));
  });
});

describe('removeProp', () => {
  it('drops the key’s lines and keeps the rest', () => {
    expect(removeProp(note, 'status')).toBe(note.replace('status: todo\n', ''));
    const block = '---\r\ntags:\r\n  - x\r\n  - y\r\nnext: 1\r\n---\r\n';
    expect(removeProp(block, 'tags')).toBe('---\r\nnext: 1\r\n---\r\n');
    expect(removeProp(note, 'nope')).toBe(note);
    expect(removeProp('# no fm', 'a')).toBe('# no fm');
  });
});

describe('kindOf', () => {
  it('infers kinds, the settings winning', () => {
    expect(kindOf({ style: 'flow', value: ['a'] })).toBe('tags');
    expect(kindOf({ style: 'scalar', value: '2025-03-04' })).toBe('date');
    expect(kindOf({ style: 'scalar', value: 'x' })).toBe('text');
    expect(kindOf({ style: 'scalar', value: 'x' }, 'select')).toBe('select');
    expect(kindOf({ style: 'scalar', value: 'soon' }, 'date')).toBe('text');
    expect(kindOf({ style: 'raw', value: 'a: 1' }, 'text')).toBe('raw');
  });
});
