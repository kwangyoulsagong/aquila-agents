import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';
import { aligns, cells, isDelimiter, pipes } from './tables';

// Live preview: Markdown shows rendered (headings, emphasis, links, checkboxes, callouts, tables) except on the
// lines the cursor is on, which show their raw text. Only decorations — the document is never rewritten, so what
// is saved is exactly what was typed. Classes are `cm-md-*`, styled in components.css (`.c-editor`).

/** `---` frontmatter at the very top: shown raw and dimmed, never parsed as Markdown. */
export function frontmatterEnd(state: EditorState): number {
  if (state.doc.lines < 2 || state.doc.line(1).text !== '---') return 0;
  for (let n = 2; n <= Math.min(state.doc.lines, 200); n++)
    if (/^(---|\.\.\.)$/.test(state.doc.line(n).text)) return state.doc.line(n).to;
  return 0;
}

/** Line numbers any selection touches: these show raw text. */
function activeLines(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return out;
}

const hide = Decoration.replace({});
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked;
  }
  toDOM() {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'cm-md-checkbox';
    box.checked = this.checked;
    box.tabIndex = -1;
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

class CalloutWidget extends WidgetType {
  constructor(readonly kind: string) {
    super();
  }
  eq(other: CalloutWidget) {
    return other.kind === this.kind;
  }
  toDOM() {
    const s = document.createElement('span');
    s.className = 'cm-md-callout-kind';
    s.textContent = this.kind;
    return s;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(other: ImageWidget) {
    return other.src === this.src && other.alt === this.alt;
  }
  toDOM() {
    const img = document.createElement('img');
    img.className = 'cm-md-img';
    img.src = this.src;
    img.alt = this.alt;
    img.draggable = false;
    // A missing file shows its Markdown instead of a broken image.
    img.onerror = () => img.replaceWith(document.createTextNode(`![${this.alt}]`));
    return img;
  }
  ignoreEvent() {
    return false;
  }
}

const CALLOUT = /^(\s*>\s*)\[!([A-Za-z-]+)\][+-]?/;

function inlineDecorations(view: EditorView, opts: LivePreviewOptions): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const fm = frontmatterEnd(state);
  const out: Range<Decoration>[] = [];
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const lineDeco = (pos: number, cls: string) => out.push(line(cls).range(state.doc.lineAt(pos).from));

  if (fm)
    for (let n = 1; n <= state.doc.lineAt(fm).number; n++) lineDeco(state.doc.line(n).from, 'cm-md-frontmatter');
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node: SyntaxNodeRef) => {
        if (node.from < fm && node.name !== 'Document') return false;
        const name = node.name;
        const h = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(name);
        if (h) {
          lineDeco(node.from, `cm-md-h cm-md-h${h[1]}`);
          return;
        }
        switch (name) {
          case 'HeaderMark': {
            if (isActive(node.from)) return;
            const parent = node.node.parent?.name ?? '';
            if (parent.startsWith('ATX')) {
              // `## ` → hide the marks and the space after them (closing `##` too).
              const end = Math.min(node.to + 1, state.doc.lineAt(node.from).to);
              out.push(hide.range(node.from, state.doc.sliceString(node.to, end) === ' ' ? end : node.to));
            } else out.push(hide.range(node.from, node.to));
            return;
          }
          case 'Emphasis':
            out.push(mark('cm-md-em').range(node.from, node.to));
            return;
          case 'StrongEmphasis':
            out.push(mark('cm-md-strong').range(node.from, node.to));
            return;
          case 'Strikethrough':
            out.push(mark('cm-md-strike').range(node.from, node.to));
            return;
          case 'InlineCode':
            out.push(mark('cm-md-code').range(node.from, node.to));
            return;
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from)) out.push(hide.range(node.from, node.to));
            return;
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode' && !isActive(node.from))
              out.push(hide.range(node.from, node.to));
            return;
          case 'Link': {
            const url = node.node.getChild('URL');
            const href = url ? state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, '') : '';
            out.push(
              Decoration.mark({ class: 'cm-md-link', attributes: href ? { 'data-url': href } : {} }).range(
                node.from,
                node.to,
              ),
            );
            if (isActive(node.from)) return false;
            const marks = node.node.getChildren('LinkMark');
            // `[text](url)`: hide `[`, and everything from `]` on.
            if (marks.length >= 2 && state.doc.sliceString(marks[0]!.from, marks[0]!.to) === '[') {
              out.push(hide.range(marks[0]!.from, marks[0]!.to));
              out.push(hide.range(marks[1]!.from, node.to));
            }
            return false;
          }
          case 'Image': {
            const url = node.node.getChild('URL');
            const marks = node.node.getChildren('LinkMark');
            const src = url && !isActive(node.from) ? opts.imageSrc(state.doc.sliceString(url.from, url.to)) : null;
            if (src && marks.length >= 2) {
              const alt = state.doc.sliceString(marks[0]!.to, marks[1]!.from);
              out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(node.from, node.to));
            } else out.push(mark('cm-md-image').range(node.from, node.to));
            return false;
          }
          case 'URL':
            out.push(mark('cm-md-url').range(node.from, node.to));
            return;
          case 'TaskMarker': {
            if (isActive(node.from)) return;
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
            out.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to));
            if (checked) {
              const l = state.doc.lineAt(node.from);
              if (node.to < l.to) out.push(mark('cm-md-done').range(node.to, l.to));
            }
            return;
          }
          case 'ListMark':
            out.push(mark('cm-md-listmark').range(node.from, node.to));
            return;
          case 'Blockquote': {
            const first = state.doc.lineAt(node.from);
            const callout = CALLOUT.exec(first.text);
            for (let n = first.number; n <= state.doc.lineAt(node.to).number; n++) {
              const l = state.doc.line(n);
              lineDeco(
                l.from,
                callout
                  ? n === first.number
                    ? 'cm-md-callout cm-md-callout-title'
                    : 'cm-md-callout'
                  : 'cm-md-quote',
              );
            }
            if (callout && !isActive(first.from)) {
              const at = first.from + callout[1]!.length;
              out.push(
                Decoration.replace({ widget: new CalloutWidget(callout[2]!.toLowerCase()) }).range(
                  at,
                  first.from + callout[0].length,
                ),
              );
            }
            return;
          }
          case 'QuoteMark':
            if (!isActive(node.from)) {
              const l = state.doc.lineAt(node.from);
              const end =
                state.doc.sliceString(node.to, node.to + 1) === ' ' && node.to < l.to ? node.to + 1 : node.to;
              out.push(hide.range(node.from, end));
            }
            return;
          case 'HorizontalRule':
            lineDeco(node.from, 'cm-md-hr');
            if (!isActive(node.from)) out.push(hide.range(node.from, node.to));
            return;
          case 'FencedCode':
          case 'CodeBlock': {
            const a = state.doc.lineAt(node.from).number;
            const b = state.doc.lineAt(node.to).number;
            for (let n = a; n <= b; n++) lineDeco(state.doc.line(n).from, 'cm-md-codeblock');
            return false;
          }
          case 'Table':
            // Tables are a block widget (below) — nothing inline.
            return false;
          default:
            return;
        }
      },
    });
    wikiLinks(state, from, to, isActive, out);
  }
  return Decoration.set(out, true);
}

const WIKI = /!?\[\[([^\]\n]+?)\]\]/g;

/** `[[target#heading|alias]]`: styled, with `[[`, `]]` (and the target when there's an alias) hidden off the cursor line. */
function wikiLinks(
  state: EditorState,
  from: number,
  to: number,
  isActive: (pos: number) => boolean,
  out: Range<Decoration>[],
) {
  const text = state.doc.sliceString(from, to);
  const tree = syntaxTree(state);
  for (const m of text.matchAll(WIKI)) {
    const start = from + m.index;
    const end = start + m[0].length;
    const inCode = tree.resolveInner(start, 1);
    if (/Code|CodeText|CodeInfo/.test(inCode.name) || /Code/.test(inCode.parent?.name ?? '')) continue;
    const inner = m[1]!;
    const target = inner.split('|')[0]!.trim();
    const open = m[0].startsWith('!') ? 3 : 2;
    out.push(
      Decoration.mark({ class: 'cm-md-wikilink', attributes: { 'data-target': target } }).range(start, end),
    );
    if (isActive(start)) continue;
    const bar = inner.indexOf('|');
    out.push(hide.range(start, start + open + (bar >= 0 ? bar + 1 : 0)));
    out.push(hide.range(end - 2, end));
  }
}

const inlinePlugin = (opts: LivePreviewOptions) =>
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = inlineDecorations(view, opts);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        )
          this.decorations = inlineDecorations(u.view, opts);
      }
    },
    { decorations: (v) => v.decorations },
  );

// ---- Tables: a rendered table (block widget) unless the cursor is inside it ----

class TableWidget extends WidgetType {
  constructor(
    readonly rows: { line: number; text: string }[],
    readonly source: string,
  ) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source && other.rows[0]?.line === this.rows[0]?.line;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table';
    const table = document.createElement('table');
    const align = aligns(this.rows[1]?.text ?? '');
    this.rows.forEach((r, i) => {
      if (i === 1) return;
      const tr = document.createElement('tr');
      cells(r.text).forEach((c, j) => {
        const cell = document.createElement(i === 0 ? 'th' : 'td');
        cell.textContent = c;
        cell.dataset.line = String(r.line);
        cell.dataset.cell = String(j);
        const a = align[j];
        if (a) cell.style.textAlign = a;
        tr.appendChild(cell);
      });
      (i === 0
        ? (table.createTHead() as HTMLElement)
        : (table.tBodies[0] ?? table.createTBody())
      ).appendChild(tr);
    });
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() {
    return false;
  }
}

function tableDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const fm = frontmatterEnd(state);
  const sel = state.selection.ranges;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table')
        return node.name === 'Document' || /^(Blockquote|BulletList|OrderedList|ListItem)$/.test(node.name);
      if (node.from < fm) return false;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      // The cursor anywhere in the table (or right at its edges) shows the raw rows.
      if (sel.some((r) => r.to >= first.from && r.from <= last.to)) return false;
      const rows: { line: number; text: string }[] = [];
      for (let n = first.number; n <= last.number; n++) rows.push({ line: n, text: state.doc.line(n).text });
      if (rows.length < 2 || !isDelimiter(rows[1]!.text)) return false;
      builder.add(
        first.from,
        last.to,
        Decoration.replace({
          widget: new TableWidget(rows, state.doc.sliceString(first.from, last.to)),
          block: true,
        }),
      );
      return false;
    },
  });
  return builder.finish();
}

const tableField = StateField.define<DecorationSet>({
  create: tableDecorations,
  update(deco, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state))
      return tableDecorations(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---- Clicks: checkboxes toggle, table cells put the cursor in that cell, links open ----

export interface LivePreviewOptions {
  /** A `[[link]]` was clicked (or ⌘-clicked on the cursor line). */
  onOpenLink: (target: string) => void;
  /** A `[text](url)` link was clicked the same way. */
  onOpenUrl: (url: string) => void;
  /** Where an image written as `![](target)` loads from, or null to leave it as text. */
  imageSrc: (target: string) => string | null;
}

const clicks = (opts: LivePreviewOptions) =>
  EditorView.domEventHandlers({
    mousedown(e, view) {
      const el = e.target as HTMLElement;
      if (el instanceof HTMLInputElement && el.classList.contains('cm-md-checkbox')) {
        e.preventDefault();
        const pos = view.posAtDOM(el);
        const text = view.state.doc.sliceString(pos, pos + 3);
        if (!/^\[[ xX]\]$/.test(text)) return true;
        // Only the one character between the brackets changes.
        view.dispatch({
          changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' },
          userEvent: 'input.toggle',
        });
        return true;
      }
      const cell = el.closest<HTMLElement>('.cm-md-table [data-line]');
      if (cell) {
        e.preventDefault();
        const l = view.state.doc.line(Number(cell.dataset.line));
        const ps = pipes(l.text);
        const p = ps[Number(cell.dataset.cell)] ?? ps[0] ?? -1;
        const at = l.from + (p < 0 ? 0 : l.text[p + 1] === ' ' ? p + 2 : p + 1);
        view.dispatch({ selection: { anchor: Math.min(at, l.to) } });
        view.focus();
        return true;
      }
      const web = el.closest<HTMLElement>('.cm-md-link[data-url]');
      if (web?.dataset.url) {
        const pos = view.posAtDOM(web);
        if (!activeLines(view.state).has(view.state.doc.lineAt(pos).number) || e.metaKey || e.ctrlKey) {
          e.preventDefault();
          opts.onOpenUrl(web.dataset.url);
          return true;
        }
      }
      const link = el.closest<HTMLElement>('.cm-md-wikilink');
      if (link?.dataset.target) {
        const pos = view.posAtDOM(link);
        const onCursorLine = activeLines(view.state).has(view.state.doc.lineAt(pos).number);
        if (!onCursorLine || e.metaKey || e.ctrlKey) {
          e.preventDefault();
          opts.onOpenLink(link.dataset.target);
          return true;
        }
      }
      return false;
    },
  });

export function livePreview(opts: LivePreviewOptions): Extension {
  return [inlinePlugin(opts), tableField, clicks(opts)];
}
