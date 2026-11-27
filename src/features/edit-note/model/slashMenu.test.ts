import { CompletionContext } from '@codemirror/autocomplete';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { translator } from '@/shared/i18n';
import { slashCompletion, slashMatches } from './slashMenu';

function complete(text: string) {
  const pos = text.indexOf('|');
  const state = EditorState.create({
    doc: text.replace('|', ''),
    extensions: markdown({ base: markdownLanguage }),
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return slashCompletion(() => translator('en'))(new CompletionContext(state, pos, false));
}

describe('slashMatches', () => {
  it('lists everything for a bare slash', () => {
    expect(slashMatches('')).toHaveLength(12);
  });

  it('finds items by English, Korean or Markdown', () => {
    expect(slashMatches('head')).toEqual(['h1', 'h2', 'h3']);
    expect(slashMatches('제목2')).toEqual(['h2']);
    expect(slashMatches('할')).toEqual(['task']);
    expect(slashMatches('todo')[0]).toBe('task');
    expect(slashMatches('hr')[0]).toBe('divider');
    expect(slashMatches('표')).toEqual(['table']);
    expect(slashMatches('zzz')).toEqual([]);
  });
});

describe('slashCompletion', () => {
  it('opens at the start of a line, after indentation', () => {
    const r = complete('a\n\n  /head|');
    expect(r?.from).toBe(5);
    expect(r?.options.map((o) => o.label)).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);
  });

  it('stays closed after text, in code and in frontmatter', () => {
    expect(complete('path a/b|')).toBeNull();
    expect(complete('```\n/|\n```')).toBeNull();
    expect(complete('---\n/|\n---\n')).toBeNull();
    expect(complete('/nothing-matches|')).toBeNull();
  });
});
