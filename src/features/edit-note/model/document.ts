import { syntaxTree } from '@codemirror/language';
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';

// T82: the note as a document — pure helpers the live preview uses (callout kinds, code-block labels, the title
// line) and the small header above the text (title when the note has no H1, folder · modified). Presentation only:
// nothing here changes the text.

/** `---` frontmatter at the very top: shown raw and dimmed, never parsed as Markdown. Its last position, or 0. */
export function frontmatterEnd(state: EditorState): number {
  if (state.doc.lines < 2 || state.doc.line(1).text !== '---') return 0;
  for (let n = 2; n <= Math.min(state.doc.lines, 200); n++)
    if (/^(---|\.\.\.)$/.test(state.doc.line(n).text)) return state.doc.line(n).to;
  return 0;
}

export type CalloutKind = 'note' | 'tip' | 'important' | 'warning' | 'caution';

// GitHub's five kinds, plus the Obsidian names people also write, folded onto the closest of the five.
const CALLOUTS: Record<string, CalloutKind> = {
  note: 'note',
  info: 'note',
  abstract: 'note',
  summary: 'note',
  tldr: 'note',
  question: 'note',
  help: 'note',
  faq: 'note',
  todo: 'note',
  quote: 'note',
  cite: 'note',
  tip: 'tip',
  hint: 'tip',
  success: 'tip',
  check: 'tip',
  done: 'tip',
  important: 'important',
  example: 'important',
  warning: 'warning',
  warn: 'warning',
  attention: 'warning',
  caution: 'caution',
  danger: 'caution',
  error: 'caution',
  bug: 'caution',
  failure: 'caution',
  fail: 'caution',
  missing: 'caution',
};

/** The card colour of `> [!kind]`: one of five; anything unknown reads as a note. */
export function calloutKind(raw: string): CalloutKind {
  return CALLOUTS[raw.toLowerCase()] ?? 'note';
}

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JSX',
  javascript: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  json: 'JSON',
  jsonc: 'JSON',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  shell: 'Shell',
  console: 'Shell',
  py: 'Python',
  python: 'Python',
  rb: 'Ruby',
  ruby: 'Ruby',
  go: 'Go',
  rs: 'Rust',
  rust: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  kotlin: 'Kotlin',
  swift: 'Swift',
  c: 'C',
  cpp: 'C++',
  'c++': 'C++',
  cs: 'C#',
  csharp: 'C#',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  xml: 'XML',
  sql: 'SQL',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  md: 'Markdown',
  markdown: 'Markdown',
  diff: 'Diff',
  mermaid: 'Mermaid',
  dockerfile: 'Dockerfile',
  graphql: 'GraphQL',
  text: 'Text',
  txt: 'Text',
  plaintext: 'Text',
};

/** The label on a code block's header, from its info string (```ts title="x" → "TypeScript"); '' when none. */
export function codeLanguage(info: string): string {
  const word = /^\s*\{?\.?([^\s{},]+)/.exec(info)?.[1] ?? '';
  if (!word) return '';
  return LANGUAGES[word.toLowerCase()] ?? word;
}

/**
 * The line of the note's title: the first block after the frontmatter, when it's a level-1 heading. That heading
 * is drawn as the document title; a note without one gets its name in the header instead.
 */
export function titleLine(state: EditorState): number | null {
  const fm = frontmatterEnd(state);
  for (let node = syntaxTree(state).topNode.firstChild; node; node = node.nextSibling) {
    if (node.to <= fm) continue;
    if (node.from < fm) return null;
    return node.name === 'ATXHeading1' || node.name === 'SetextHeading1'
      ? state.doc.lineAt(node.from).number
      : null;
  }
  return null;
}

// ---- The header: a block above the text (scrolls with it) ----

export interface DocLook {
  /** The note's name, shown as the title only when it has no H1 of its own. */
  name: string;
  /** Muted line under it: folder · modified. */
  meta: string;
  /** Code-block copy button labels. */
  copy: string;
  copied: string;
}

/** Sets what the header and the code-block buttons show (the panel sends it: names and dates are its to format). */
export const setDocLook = StateEffect.define<DocLook>();

export const docLookField = StateField.define<DocLook | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setDocLook)) return e.value;
    return v;
  },
});

class HeaderWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly meta: string,
  ) {
    super();
  }
  eq(other: HeaderWidget) {
    return other.title === this.title && other.meta === this.meta;
  }
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-md-dochead';
    if (this.title) {
      const t = document.createElement('div');
      t.className = 'cm-md-doctitle';
      t.textContent = this.title;
      el.appendChild(t);
    }
    if (this.meta) {
      const m = document.createElement('div');
      m.className = 'cm-md-docmeta';
      m.textContent = this.meta;
      el.appendChild(m);
    }
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function headerDeco(state: EditorState): DecorationSet {
  const look = state.field(docLookField, false);
  if (!look || (!look.meta && !look.name)) return Decoration.none;
  const title = titleLine(state) === null ? look.name : '';
  if (!title && !look.meta) return Decoration.none;
  return Decoration.set(
    Decoration.widget({ widget: new HeaderWidget(title, look.meta), block: true, side: -1 }).range(0),
  );
}

/** The header block. Cheap to rebuild: the title check looks at the first block only (the widget's `eq` keeps the DOM). */
const headerField = StateField.define<DecorationSet>({
  create: headerDeco,
  update(deco, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setDocLook)) || syntaxTree(tr.startState) !== syntaxTree(tr.state))
      return headerDeco(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function documentHeader(): Extension {
  return [docLookField, headerField];
}
