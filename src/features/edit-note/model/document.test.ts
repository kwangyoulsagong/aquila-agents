import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorSelection, EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { calloutKind, codeLanguage, frontmatterEnd, titleLine } from './document';
import { activeLines, fencedBody } from './livePreview';
import { isReading, isReadingKey, reading } from './readingMode';

const md = (doc: string, extra: Parameters<typeof EditorState.create>[0] = {}) => {
  const state = EditorState.create({
    doc,
    ...extra,
    extensions: [markdown({ base: markdownLanguage }), extra.extensions ?? []],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return state;
};

describe('callout kinds', () => {
  it('keeps the five GitHub kinds', () => {
    for (const k of ['note', 'tip', 'important', 'warning', 'caution'] as const)
      expect(calloutKind(k)).toBe(k);
    expect(calloutKind('WARNING')).toBe('warning');
  });
  it('folds Obsidian names onto the closest kind, unknown ones onto note', () => {
    expect(calloutKind('info')).toBe('note');
    expect(calloutKind('success')).toBe('tip');
    expect(calloutKind('danger')).toBe('caution');
    expect(calloutKind('example')).toBe('important');
    expect(calloutKind('whatever')).toBe('note');
  });
});

describe('code block label', () => {
  it('names common languages and keeps others as written', () => {
    expect(codeLanguage('ts')).toBe('TypeScript');
    expect(codeLanguage('bash')).toBe('Shell');
    expect(codeLanguage('ts title="a.ts"')).toBe('TypeScript');
    expect(codeLanguage('{.python}')).toBe('Python');
    expect(codeLanguage('elixir')).toBe('elixir');
    expect(codeLanguage('')).toBe('');
    expect(codeLanguage('   ')).toBe('');
  });
  it('copies the body without the fences', () => {
    const doc = 'a\n\n```ts\nconst x = 1;\nconst y = 2;\n```\n';
    const s = md(doc);
    expect(fencedBody(s, doc.indexOf('const'))).toBe('const x = 1;\nconst y = 2;');
    expect(fencedBody(s, 0)).toBe('');
    const open = md('```\nline\n');
    expect(fencedBody(open, 5)).toBe('line\n');
  });
});

describe('title line', () => {
  it('is the first block when it is an H1', () => {
    expect(titleLine(md('# Title\n\ntext'))).toBe(1);
    expect(titleLine(md('\n\n# Title\n'))).toBe(3);
    expect(titleLine(md('Title\n=====\n'))).toBe(1);
  });
  it('comes after the frontmatter', () => {
    const s = md('---\ntags: [a]\n---\n# Title\n');
    expect(frontmatterEnd(s)).toBeGreaterThan(0);
    expect(titleLine(s)).toBe(4);
  });
  it('is none when the note starts otherwise', () => {
    expect(titleLine(md('text\n\n# Later\n'))).toBeNull();
    expect(titleLine(md('## Sub\n'))).toBeNull();
    expect(titleLine(md(''))).toBeNull();
  });
});

describe('reading mode', () => {
  const doc = '# A\n\n- [ ] b\n';
  it('leaves no line raw, wherever the cursor is', () => {
    const editing = md(doc, { selection: EditorSelection.cursor(1) });
    expect([...activeLines(editing)]).toEqual([1]);
    expect(isReading(editing)).toBe(false);
    const read = md(doc, { selection: EditorSelection.cursor(1), extensions: reading(true) });
    expect(isReading(read)).toBe(true);
    expect(read.readOnly).toBe(true);
    expect(activeLines(read).size).toBe(0);
  });
  it('toggles with ⌘E on macOS, Ctrl+E elsewhere, nothing else', () => {
    const k = (o: Partial<KeyboardEvent>) => ({
      code: 'KeyE',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      ...o,
    });
    expect(isReadingKey(k({ metaKey: true }), true)).toBe(true);
    expect(isReadingKey(k({ ctrlKey: true }), true)).toBe(false);
    expect(isReadingKey(k({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isReadingKey(k({ ctrlKey: true }), false)).toBe(true);
    expect(isReadingKey(k({ metaKey: true, code: 'KeyW' }), true)).toBe(false);
  });
});
