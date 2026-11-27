import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateEffect, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  hoverTooltip,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { Translate } from '@/shared/i18n';
import { ID_RE, markable, type IdIndex, type IdInfo, type IdState } from './ids';

// The editor side of requirement IDs (T79): IDs the index knows get a quiet underline (state in `data-state`), a
// hover card (defining note, status, where it's referenced) and ⌘-click to the defining note. Only the visible
// lines are scanned; the ID index itself is built once per snapshot (see `idIndex`).

export interface NoteIdsOptions {
  /** The ID index of the snapshot right now, or null (no index yet). */
  index: () => IdIndex | null;
  /** Called when the snapshot changes: the marks are redrawn. Returns the unsubscribe. */
  subscribe: (cb: () => void) => () => void;
  onOpen: (path: string) => void;
  t: () => Translate;
}

const refresh = StateEffect.define<null>();
/** No marks inside code or URLs. */
const SKIP = new Set(['FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'URL', 'Autolink']);

function inCode(state: EditorState, pos: number): boolean {
  const start = syntaxTree(state).resolveInner(pos, 1);
  for (let n: typeof start | null = start; n; n = n.parent) if (SKIP.has(n.name)) return true;
  return false;
}

const marks = new Map<string, Decoration>();
const markOf = (state: IdState, id: string) => {
  const key = `${state}\u0000${id}`;
  let d = marks.get(key);
  if (!d) {
    d = Decoration.mark({ class: 'c-noteid', attributes: { 'data-state': state, 'data-id': id } });
    if (marks.size > 2000) marks.clear();
    marks.set(key, d);
  }
  return d;
};

function build(view: EditorView, ix: IdIndex | null): DecorationSet {
  if (!ix) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    for (const m of text.matchAll(ID_RE)) {
      const id = m[0];
      if (!markable(ix, id)) continue;
      const at = from + m.index;
      if (inCode(view.state, at)) continue;
      b.add(at, at + id.length, markOf(ix.info(id).state, id));
    }
  }
  return b.finish();
}

/** The ID under `pos` on its line, if any. */
function idAt(state: EditorState, pos: number): { id: string; from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  for (const m of line.text.matchAll(ID_RE)) {
    const from = line.from + m.index;
    const to = from + m[0].length;
    if (pos >= from && pos <= to) return { id: m[0], from, to };
  }
  return null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** The hover card's DOM. */
export function tipDom(info: IdInfo, t: Translate, onOpen: (path: string) => void): HTMLElement {
  const dom = el('div', 'c-noteid-tip');
  const link = (label: string, path: string | undefined) => {
    const b = el('button', 'c-noteid-tip__link', label);
    b.type = 'button';
    if (path) {
      b.title = path;
      b.onclick = (e) => {
        e.preventDefault();
        onOpen(path);
      };
    }
    return b;
  };
  if (info.state === 'defined') {
    const d = info.defs[0]!;
    const title = link(d.label, d.path);
    title.classList.add('c-noteid-tip__title');
    dom.append(title);
    if (d.status) dom.append(el('span', 'c-noteid-tip__status', d.status));
  } else {
    dom.append(el('div', 'c-noteid-tip__title', info.id));
    if (info.state === 'duplicate') {
      dom.append(el('div', 'c-noteid-tip__warn', t('noteId.duplicate', { n: String(info.defs.length) })));
      for (const d of info.defs) dom.append(link(d.label, d.path));
    } else
      dom.append(
        el(
          'div',
          info.state === 'unknown' ? 'c-noteid-tip__warn' : 'c-noteid-tip__meta',
          t(info.state === 'unknown' ? 'noteId.unknown' : 'noteId.loose'),
        ),
      );
  }
  dom.append(
    el(
      'div',
      'c-noteid-tip__meta',
      t('noteId.refs', {
        notes: String(info.notes.length),
        sessions: String(info.sessions.length),
        files: String(info.files.length),
      }),
    ),
  );
  if (info.defs.length) dom.append(el('div', 'c-noteid-tip__meta', t('noteId.open')));
  return dom;
}

export function noteIds(opts: NoteIdsOptions): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      off: () => void;
      constructor(view: EditorView) {
        this.decorations = build(view, opts.index());
        this.off = opts.subscribe(() => view.dispatch({ effects: refresh.of(null) }));
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          syntaxTree(u.startState) !== syntaxTree(u.state) ||
          u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))
        )
          this.decorations = build(u.view, opts.index());
      }
      destroy() {
        this.off();
      }
    },
    { decorations: (v) => v.decorations },
  );

  const tooltip = hoverTooltip((view, pos) => {
    const ix = opts.index();
    const hit = ix ? idAt(view.state, pos) : null;
    if (!ix || !hit || !markable(ix, hit.id) || inCode(view.state, hit.from)) return null;
    const info = ix.info(hit.id);
    return {
      pos: hit.from,
      end: hit.to,
      above: true,
      create: () => ({ dom: tipDom(info, opts.t(), opts.onOpen) }),
    };
  });

  const clicks = EditorView.domEventHandlers({
    mousedown(e) {
      if (!(e.metaKey || e.ctrlKey)) return false;
      const mark = (e.target as HTMLElement).closest<HTMLElement>('.c-noteid');
      const id = mark?.dataset.id;
      const ix = opts.index();
      const path = id && ix ? ix.info(id).defs[0]?.path : undefined;
      if (!path) return false;
      e.preventDefault();
      opts.onOpen(path);
      return true;
    },
  });

  return [plugin, tooltip, clicks];
}
