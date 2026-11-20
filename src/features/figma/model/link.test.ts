import { describe, expect, it } from 'vitest';
import { chipInput, chipPrompt, chipsFor, parseFigmaLink } from './link';

describe('parseFigmaLink', () => {
  it('reads a design link with a node', () => {
    expect(
      parseFigmaLink('look at https://www.figma.com/design/AbC123xyz/Shop-App?node-id=12-34&t=x9 please'),
    ).toEqual({
      url: 'https://www.figma.com/design/AbC123xyz/Shop-App?node-id=12-34&t=x9',
      kind: 'design',
      fileKey: 'AbC123xyz',
      nodeId: '12-34',
    });
  });
  it('legacy file, proto and make links are design files; board is FigJam', () => {
    expect(parseFigmaLink('https://figma.com/file/K1/x')?.kind).toBe('design');
    expect(parseFigmaLink('https://www.figma.com/proto/K2/x?node-id=1-2')?.nodeId).toBe('1-2');
    expect(parseFigmaLink('https://www.figma.com/make/K3/x')?.kind).toBe('design');
    expect(parseFigmaLink('https://www.figma.com/board/K4/Flows')).toMatchObject({
      kind: 'board',
      fileKey: 'K4',
    });
  });
  it('drops trailing punctuation and quotes', () => {
    expect(parseFigmaLink('"https://www.figma.com/design/K5/x?node-id=1-2".')?.url).toBe(
      'https://www.figma.com/design/K5/x?node-id=1-2',
    );
    expect(parseFigmaLink('(https://www.figma.com/design/K6/x).')?.url).toBe(
      'https://www.figma.com/design/K6/x',
    );
  });
  it('ignores other links and Figma pages that are not files', () => {
    for (const text of [
      'https://example.com/design/K/x',
      'https://www.figma.com/community',
      'figma.com/design/K/x',
      '',
    ])
      expect(parseFigmaLink(text)).toBeNull();
  });
});

describe('chipsFor', () => {
  it('design files: Design chips first, then Build', () => {
    const chips = chipsFor(parseFigmaLink('https://www.figma.com/design/K/x')!);
    expect(chips.map((c) => `${c.group}:${c.id}`)).toEqual([
      'design:compare',
      'design:comments',
      'build:implement',
      'build:assets',
    ]);
  });
  it('FigJam boards: flow and comments only', () => {
    expect(chipsFor(parseFigmaLink('https://www.figma.com/board/K/x')!).map((c) => c.id)).toEqual([
      'flow',
      'comments',
    ]);
  });
});

describe('chipInput', () => {
  it('one line after a space, so it follows the pasted link', () => {
    expect(chipInput('Do this.\n  Then that. ')).toBe(' Do this. Then that.');
  });
});

describe('chipPrompt', () => {
  const chips = chipsFor(parseFigmaLink('https://www.figma.com/design/K/x')!);
  const byId = (id: string) => chips.find((c) => c.id === id)!;
  it('Claude: compare and implement add the Chrome check', () => {
    expect(chipPrompt(byId('compare'), 'claude', 'Compare.', 'Then Chrome.')).toBe(' Compare. Then Chrome.');
    expect(chipPrompt(byId('implement'), 'claude', 'Build.', 'Then Chrome.')).toBe(' Build. Then Chrome.');
  });
  it('Codex and the other chips: MCP only', () => {
    expect(chipPrompt(byId('compare'), 'codex', 'Compare.', 'Then Chrome.')).toBe(' Compare.');
    expect(chipPrompt(byId('comments'), 'claude', 'Comments.', 'Then Chrome.')).toBe(' Comments.');
  });
});
