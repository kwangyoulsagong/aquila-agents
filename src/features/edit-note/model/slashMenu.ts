import {
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorView } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import { translator, type Translate } from '@/shared/i18n';
import { SLASH_KINDS, slashSnippet, type SlashKind } from './blockEdits';
import { frontmatterEnd } from './livePreview';

// The slash menu (T77): `/` at the start of a line (after its indentation) lists blocks to insert. Picking one
// replaces only the `/query` with the block's Markdown. A completion source for the editor's autocompletion, so
// it shares its tooltip, keys and IME handling (CodeMirror ignores keys while an IME is composing).

type Key = Parameters<Translate>[0];

const LABEL: Record<SlashKind, Key> = {
  h1: 'note.slash.h1',
  h2: 'note.slash.h2',
  h3: 'note.slash.h3',
  bullet: 'note.slash.bullet',
  ordered: 'note.slash.ordered',
  task: 'note.slash.task',
  quote: 'note.slash.quote',
  callout: 'note.slash.callout',
  code: 'note.slash.code',
  table: 'note.slash.table',
  divider: 'note.slash.divider',
  link: 'note.slash.link',
};

/** The Markdown each item writes, shown beside its label. */
const HINT: Record<SlashKind, string> = {
  h1: '#',
  h2: '##',
  h3: '###',
  bullet: '-',
  ordered: '1.',
  task: '- [ ]',
  quote: '>',
  callout: '> [!NOTE]',
  code: '```',
  table: '| |',
  divider: '---',
  link: '[[ ]]',
};

/** Extra words that find an item, besides its Korean and English labels. */
const ALIASES: Record<SlashKind, string[]> = {
  h1: ['h1', 'title', '#'],
  h2: ['h2', '##'],
  h3: ['h3', '###'],
  bullet: ['ul', 'list', 'bullet', '-'],
  ordered: ['ol', 'number', '1.'],
  task: ['todo', 'task', 'checkbox', '[]'],
  quote: ['blockquote', '>'],
  callout: ['note', 'admonition', 'tip', '!'],
  code: ['pre', 'fence', '```'],
  table: ['grid', '|'],
  divider: ['hr', 'line', 'separator', '---'],
  link: ['wiki', 'link', '[['],
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/** Items matching `query` (any label language or alias), best first: label prefix, word prefix, anywhere. */
export function slashMatches(query: string): SlashKind[] {
  const q = norm(query);
  if (!q) return [...SLASH_KINDS];
  const ko = translator('ko');
  const en = translator('en');
  const scored: { kind: SlashKind; score: number; i: number }[] = [];
  SLASH_KINDS.forEach((kind, i) => {
    const labels = [ko(LABEL[kind]), en(LABEL[kind])].map(norm);
    const words = ALIASES[kind].map(norm);
    const score = labels.some((l) => l.startsWith(q))
      ? 0
      : words.some((w) => w.startsWith(q))
        ? 1
        : [...labels, ...words].some((w) => w.includes(q))
          ? 2
          : -1;
    if (score >= 0) scored.push({ kind, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.kind);
}

/** Inside code, HTML or frontmatter a `/` is just a slash. */
function inCode(ctx: CompletionContext, pos: number): boolean {
  if (pos < frontmatterEnd(ctx.state)) return true;
  for (
    let n: SyntaxNode | null = syntaxTree(ctx.state).resolveInner(pos, -1);
    n;
    n = n.parent
  )
    if (/^(FencedCode|CodeBlock|HTMLBlock|CommentBlock)$/.test(n.name)) return true;
  return false;
}

function apply(kind: SlashKind) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    if (view.composing || view.state.readOnly) return;
    const { doc } = view.state;
    const line = doc.lineAt(from);
    const prevBlank = line.number === 1 || !doc.line(line.number - 1).text.trim();
    const s = slashSnippet(kind, view.state.lineBreak, prevBlank);
    view.dispatch({
      changes: { from, to, insert: s.insert },
      selection: { anchor: from + s.cursor },
      userEvent: 'input.complete',
      scrollIntoView: true,
    });
    // `[[` goes straight on to picking the note.
    if (kind === 'link') startCompletion(view);
  };
}

/** The completion source. `t` is read on each `/`, so it follows the app language. */
export function slashCompletion(t: () => Translate) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/^[ \t]*\/[^\s/]*$/);
    if (!m) return null;
    const slash = m.from + m.text.indexOf('/');
    if (inCode(ctx, slash)) return null;
    const kinds = slashMatches(m.text.slice(m.text.indexOf('/') + 1));
    if (!kinds.length) return null;
    const tr = t();
    return {
      from: slash,
      to: ctx.pos,
      filter: false,
      options: kinds.map((kind) => ({
        label: tr(LABEL[kind]),
        detail: HINT[kind],
        type: 'slash',
        apply: apply(kind),
      })),
    };
  };
}
