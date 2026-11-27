import { describe, expect, it } from 'vitest';
import { blockAtLine, parseBlocks, type Block } from './blocks';

/** `kind:text` of each block (children indented), to compare a parse at a glance. */
function shape(src: string, blocks: Block[] = parseBlocks(src).blocks, depth = 0): string[] {
  return blocks.flatMap((b) => [
    `${'  '.repeat(depth)}${b.kind}${b.level ? b.level : ''}:${JSON.stringify(src.slice(b.from, b.to))}`,
    ...shape(src, b.children, depth + 1),
  ]);
}

describe('parseBlocks', () => {
  it('splits headings, paragraphs, lists, quotes, hr, images', () => {
    const src =
      '# Title\n\nSome text\nmore text\n\n- a\n- [ ] b\n1. c\n\n> quote\n> more\n\n---\n\n![x](a.png)\n';
    expect(shape(src)).toEqual([
      'heading1:"# Title"',
      'paragraph:"Some text\\nmore text"',
      'bullet:"- a"',
      'task:"- [ ] b"',
      'ordered:"1. c"',
      'quote:"> quote\\n> more"',
      'hr:"---"',
      'image:"![x](a.png)"',
    ]);
  });

  it('keeps exact ranges with CRLF', () => {
    const src = '# A\r\n\r\npara\r\nline\r\n\r\n- x\r\n';
    const { blocks } = parseBlocks(src);
    expect(blocks.map((b) => src.slice(b.from, b.to))).toEqual(['# A', 'para\r\nline', '- x']);
    expect(blocks[1]).toMatchObject({ line: 2, lastLine: 3 });
  });

  it('nests list children under their item', () => {
    const src = '- a\n  lazy\n  - b\n    - c\n  - d\n- e\n';
    expect(shape(src)).toEqual([
      'bullet:"- a\\n  lazy\\n  - b\\n    - c\\n  - d"',
      '  bullet:"  - b\\n    - c"',
      '    bullet:"    - c"',
      '  bullet:"  - d"',
      'bullet:"- e"',
    ]);
  });

  it('keeps a loose item with a paragraph after a blank line', () => {
    const src = '- a\n\n  more\n\nafter\n';
    expect(shape(src)).toEqual(['bullet:"- a\\n\\n  more"', '  paragraph:"  more"', 'paragraph:"after"']);
  });

  it('treats a fence as one block, `#` inside included', () => {
    const src = 'x\n\n```md\n# not a heading\n\n- nor a list\n```\n# real';
    expect(shape(src)).toEqual([
      'paragraph:"x"',
      'code:"```md\\n# not a heading\\n\\n- nor a list\\n```"',
      'heading1:"# real"',
    ]);
  });

  it('runs an unclosed fence to the end', () => {
    expect(shape('```\n# a\nb')).toEqual(['code:"```\\n# a\\nb"']);
  });

  it('finds tables (needs the delimiter row)', () => {
    const src = '| a | b |\n| --- | --- |\n| 1 | 2 |\ntext\n\n| not | table |\n';
    expect(shape(src)).toEqual([
      'table:"| a | b |\\n| --- | --- |\\n| 1 | 2 |"',
      'paragraph:"text"',
      'paragraph:"| not | table |"',
    ]);
  });

  it('reads frontmatter only at the top and closed', () => {
    expect(shape('---\ntitle: x\n---\n# H')).toEqual([
      'frontmatter:"---\\ntitle: x\\n---"',
      'heading1:"# H"',
    ]);
    expect(shape('---\nnot closed')[0]).toBe('hr:"---"');
  });

  it('knows callouts, setext headings, html and raw blocks', () => {
    const src = '> [!NOTE]\n> body\n\nTitle\n===\n\n<div>\nx\n</div>\n\n$$\na\n$$\n\n[ref]: http://x\n';
    expect(shape(src)).toEqual([
      'callout:"> [!NOTE]\\n> body"',
      'heading1:"Title\\n==="',
      'html:"<div>\\nx\\n</div>"',
      'raw:"$$\\na\\n$$"',
      'raw:"[ref]: http://x"',
    ]);
  });

  it('finds the innermost block on a line', () => {
    const { blocks } = parseBlocks('- a\n  - b\n\npara');
    expect(blockAtLine(blocks, 1)?.block.from).toBe(4);
    expect(blockAtLine(blocks, 0)?.block.from).toBe(0);
    expect(blockAtLine(blocks, 2)).toBeNull();
    expect(blockAtLine(blocks, 3)?.block.kind).toBe('paragraph');
  });
});
