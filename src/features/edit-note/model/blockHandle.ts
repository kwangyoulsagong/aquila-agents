import { Prec, type EditorState, type Extension, type Text } from '@codemirror/state';
import { EditorView, ViewPlugin, keymap, type Command, type ViewUpdate } from '@codemirror/view';
import type { Translate } from '@/shared/i18n';
import {
  canTurn,
  deleteBlock,
  duplicateBlock,
  moveBlock,
  stepTarget,
  turnInto,
  type Change,
  type Side,
  type TurnKind,
} from './blockEdits';
import { blockAtLine, parseBlocks, type Block, type Located, type Parsed } from './blocks';

// Block affordances over the Markdown text (T77): a ⋮⋮ handle left of the hovered block — drag it to move the
// block (with its nested items), click it for the block menu (turn into, duplicate, delete, copy) — and ⌥⇧↑ / ⌥⇧↓
// to move the block at the cursor. Every action is one transaction of text splices from `blockEdits.ts`.

type Key = Parameters<Translate>[0];

/** The block model of a document, parsed once per document version. */
const cache = new WeakMap<Text, Parsed>();
export function parsedOf(state: EditorState): Parsed {
  let p = cache.get(state.doc);
  if (!p) {
    p = parseBlocks(state.doc.toString());
    cache.set(state.doc, p);
  }
  return p;
}

const blockAt = (state: EditorState, pos: number): Located | null =>
  blockAtLine(parsedOf(state).blocks, state.doc.lineAt(pos).number - 1);

/** ⌥⇧↑ / ⌥⇧↓: the block at the cursor one step up / down among its siblings, the cursor going with it. */
const moveStep =
  (dir: -1 | 1): Command =>
  (view) => {
    if (view.composing) return false;
    if (view.state.readOnly) return true;
    const head = view.state.selection.main.head;
    const loc = blockAt(view.state, head);
    if (!loc) return true;
    const p = parsedOf(view.state);
    const step = stepTarget(p, loc.block, dir);
    const r = step && moveBlock(p, loc.block, step.target, step.side);
    if (r)
      view.dispatch({
        changes: r.changes,
        selection: { anchor: r.map(head) },
        scrollIntoView: true,
        userEvent: 'move.block',
      });
    return true;
  };

const TURN: { kind: TurnKind; label: Key; hint: string }[] = [
  { kind: 'paragraph', label: 'note.block.paragraph', hint: '' },
  { kind: 'h1', label: 'note.slash.h1', hint: '#' },
  { kind: 'h2', label: 'note.slash.h2', hint: '##' },
  { kind: 'h3', label: 'note.slash.h3', hint: '###' },
  { kind: 'bullet', label: 'note.slash.bullet', hint: '-' },
  { kind: 'ordered', label: 'note.slash.ordered', hint: '1.' },
  { kind: 'task', label: 'note.slash.task', hint: '- [ ]' },
  { kind: 'quote', label: 'note.slash.quote', hint: '>' },
];

/** Pixels the pointer travels before a press on the handle becomes a drag (below that it's a click). */
const DRAG_START = 4;
/** Room between the handle and the block's text. */
const HANDLE_GAP = 4;

interface Drop {
  target: Block;
  side: Side;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}

class BlockHandle {
  readonly handle = el('button', 'c-editor__handle');
  readonly drop = el('div', 'c-editor__drop');
  menu: HTMLDivElement | null = null;
  /** The hovered block and the document it belongs to. */
  block: Block | null = null;
  doc: Text | null = null;
  drag: { x: number; y: number; moving: boolean; at: Drop | null } | null = null;

  constructor(
    readonly view: EditorView,
    readonly t: () => Translate,
  ) {
    this.handle.type = 'button';
    this.handle.textContent = '⋮⋮';
    this.handle.hidden = true;
    this.handle.setAttribute('aria-haspopup', 'menu');
    this.handle.setAttribute('aria-expanded', 'false');
    this.drop.hidden = true;
    view.scrollDOM.append(this.handle, this.drop);
    view.scrollDOM.addEventListener('mousemove', this.onHover);
    view.scrollDOM.addEventListener('mouseleave', this.onLeave);
    this.handle.addEventListener('pointerdown', this.onDown);
    this.handle.addEventListener('pointermove', this.onDrag);
    this.handle.addEventListener('pointerup', this.onUp);
    this.handle.addEventListener('pointercancel', this.onCancel);
    this.handle.addEventListener('click', this.onClick);
    document.addEventListener('pointerdown', this.onOutside, true);
  }

  update(u: ViewUpdate) {
    if (u.docChanged || u.state.readOnly) {
      this.onCancel();
      this.closeMenu(false);
      this.hide();
    } else if (u.geometryChanged && this.block && !this.handle.hidden) this.place();
  }

  destroy() {
    this.view.scrollDOM.removeEventListener('mousemove', this.onHover);
    this.view.scrollDOM.removeEventListener('mouseleave', this.onLeave);
    document.removeEventListener('pointerdown', this.onOutside, true);
    this.handle.remove();
    this.drop.remove();
    this.menu?.remove();
  }

  /** The block still describes the current document (nothing was typed since it was found). */
  get live(): boolean {
    return !!this.block && this.doc === this.view.state.doc;
  }

  hide() {
    if (this.drag || this.menu) return;
    this.handle.hidden = true;
    this.block = null;
  }

  // ---- Hover: the handle follows the block under the pointer ----

  onHover = (e: MouseEvent) => {
    if (this.drag || this.menu || this.view.state.readOnly) return;
    if (e.target instanceof Node && this.handle.contains(e.target)) return;
    const view = this.view;
    const y = e.clientY - view.documentTop;
    if (y < 0 || y > view.contentHeight) return this.hide();
    const loc = blockAt(view.state, view.lineBlockAtHeight(y).from);
    if (!loc || loc.block.kind === 'frontmatter') return this.hide();
    if (this.live && this.block === loc.block && !this.handle.hidden) return;
    this.block = loc.block;
    this.doc = view.state.doc;
    this.handle.title = this.t()('note.block.handle');
    this.handle.setAttribute('aria-label', this.t()('note.block.handle'));
    this.place();
  };

  onLeave = (e: MouseEvent) => {
    const to = e.relatedTarget;
    if (to instanceof Node && (this.handle.contains(to) || this.menu?.contains(to))) return;
    this.hide();
  };

  /** Puts the handle beside the block's first line (at its indentation, centred on the line). */
  place() {
    const view = this.view;
    view.requestMeasure({
      key: this,
      read: () => {
        const b = this.block;
        if (!b || !this.live) return null;
        const at = b.from + b.indent.length;
        const c = view.coordsAtPos(at, 1);
        const box = view.scrollDOM.getBoundingClientRect();
        const content = view.contentDOM.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
        const top = c?.top ?? view.lineBlockAt(b.from).top + view.documentTop;
        // A block widget (a rendered table) reports its whole height: centre on its first line instead.
        const bottom = Math.min(c?.bottom ?? top + view.defaultLineHeight, top + view.defaultLineHeight * 2);
        const x = b.indent && c ? c.left : content.left + pad;
        return {
          top: (top + bottom) / 2 - this.handle.offsetHeight / 2 - box.top + view.scrollDOM.scrollTop,
          left: x - this.handle.offsetWidth - HANDLE_GAP - box.left + view.scrollDOM.scrollLeft,
        };
      },
      write: (pos) => {
        if (!pos) return;
        this.handle.style.top = `${pos.top}px`;
        this.handle.style.left = `${Math.max(0, pos.left)}px`;
        if (this.handle.hidden) this.handle.hidden = false;
      },
    });
    // Shown before it's measured, so its size is known.
    this.handle.hidden = false;
  }

  // ---- Drag: move the block above / below another ----

  onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !this.live) return;
    e.preventDefault();
    this.handle.setPointerCapture(e.pointerId);
    this.drag = { x: e.clientX, y: e.clientY, moving: false, at: null };
  };

  onDrag = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (!d.moving) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_START) return;
      d.moving = true;
      this.closeMenu(false);
      this.handle.dataset.dragging = '';
    }
    this.autoScroll(e.clientY);
    d.at = this.dropAt(e.clientY);
    this.showDrop(d.at);
  };

  onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    if (this.handle.hasPointerCapture(e.pointerId)) this.handle.releasePointerCapture(e.pointerId);
    this.drag = null;
    delete this.handle.dataset.dragging;
    this.drop.hidden = true;
    if (!d.moving) {
      this.toggleMenu();
      return;
    }
    const b = this.block;
    if (!d.at || !b || !this.live) return;
    const r = moveBlock(parsedOf(this.view.state), b, d.at.target, d.at.side);
    if (!r) return;
    this.view.dispatch({
      changes: r.changes,
      selection: { anchor: r.map(b.from + b.indent.length) },
      scrollIntoView: true,
      userEvent: 'move.drop',
    });
    this.view.focus();
  };

  onCancel = () => {
    if (!this.drag) return;
    this.drag = null;
    delete this.handle.dataset.dragging;
    this.drop.hidden = true;
  };

  /** Keyboard activation of the handle (Enter / Space) opens the menu; pointer clicks are handled on pointerup. */
  onClick = (e: MouseEvent) => {
    if (e.detail === 0) this.toggleMenu(true);
  };

  /** Scrolls while dragging near the top or bottom edge. */
  autoScroll(y: number) {
    const box = this.view.scrollDOM.getBoundingClientRect();
    const edge = this.view.defaultLineHeight * 2;
    if (y < box.top + edge) this.view.scrollDOM.scrollTop -= this.view.defaultLineHeight;
    else if (y > box.bottom - edge) this.view.scrollDOM.scrollTop += this.view.defaultLineHeight;
  }

  /** Where the dragged block would land for a pointer at `clientY`: before / after the block under it. */
  dropAt(clientY: number): Drop | null {
    const view = this.view;
    const moving = this.block;
    if (!moving || !this.live) return null;
    const p = parsedOf(view.state);
    const top = p.blocks.filter((b) => b.kind !== 'frontmatter');
    if (!top.length) return null;
    const y = clientY - view.documentTop;
    let at: Drop;
    if (y < 0) at = { target: top[0]!, side: 'before' };
    else if (y > view.contentHeight) at = { target: top[top.length - 1]!, side: 'after' };
    else {
      const lb = view.lineBlockAtHeight(y);
      const n = view.state.doc.lineAt(lb.from).number - 1;
      const loc = blockAtLine(p.blocks, n);
      if (!loc) {
        // A blank line between blocks: before the next top-level block, or after the last.
        const next = top.find((b) => b.line > n);
        at = next ? { target: next, side: 'before' } : { target: top[top.length - 1]!, side: 'after' };
      } else {
        const t = loc.block;
        const first = view.lineBlockAt(t.from);
        const side: Side = y < first.top + first.height / 2 ? 'before' : 'after';
        // Below the middle of an item that has nested items: it becomes the first of them.
        at =
          side === 'after' && t.children.length
            ? { target: t.children[0]!, side: 'before' }
            : { target: t, side };
        if (t.kind === 'frontmatter') at = { target: t, side: 'after' };
      }
    }
    // Not into itself.
    if (at.target.line >= moving.line && at.target.lastLine <= moving.lastLine) return null;
    return at;
  }

  showDrop(at: Drop | null) {
    if (!at) {
      this.drop.hidden = true;
      return;
    }
    const view = this.view;
    const t = at.target;
    const box = view.scrollDOM.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
    const line = at.side === 'before' ? view.lineBlockAt(t.from) : view.lineBlockAt(t.to);
    const y = (at.side === 'before' ? line.top : line.bottom) + view.documentTop;
    const x = t.indent
      ? (view.coordsAtPos(t.from + t.indent.length, 1)?.left ?? content.left + pad)
      : content.left + pad;
    this.drop.style.top = `${y - box.top + view.scrollDOM.scrollTop - this.drop.offsetHeight / 2}px`;
    this.drop.style.left = `${x - box.left + view.scrollDOM.scrollLeft}px`;
    this.drop.style.width = `${Math.max(0, content.right - pad - x)}px`;
    this.drop.hidden = false;
  }

  // ---- Menu: turn into, duplicate, delete, copy ----

  onOutside = (e: PointerEvent) => {
    if (!this.menu) return;
    const t = e.target;
    if (t instanceof Node && (this.menu.contains(t) || this.handle.contains(t))) return;
    this.closeMenu(false);
  };

  toggleMenu(keyboard = false) {
    if (this.menu) this.closeMenu(true);
    else this.openMenu(keyboard);
  }

  closeMenu(focusEditor: boolean) {
    if (!this.menu) return;
    this.menu.remove();
    this.menu = null;
    this.handle.setAttribute('aria-expanded', 'false');
    if (focusEditor) this.view.focus();
  }

  openMenu(keyboard: boolean) {
    const b = this.block;
    if (!b || !this.live) return;
    const t = this.t();
    const menu = el('div', 'c-editor__menu');
    menu.setAttribute('role', 'menu');
    menu.tabIndex = -1;
    const item = (label: string, hint: string, run: () => void, disabled = false) => {
      const btn = el('button', 'c-editor__menu-item');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.disabled = disabled;
      const text = document.createElement('span');
      text.textContent = label;
      btn.append(text);
      if (hint) {
        const h = el('span', 'c-editor__menu-hint');
        h.textContent = hint;
        btn.append(h);
      }
      btn.addEventListener('click', () => {
        // Closed (and the editor focused) first: the edit's update would close it without focusing.
        const live = this.live;
        this.closeMenu(true);
        if (live) run();
      });
      menu.append(btn);
    };
    const title = el('div', 'c-editor__menu-title');
    title.textContent = t('note.block.turnInto');
    menu.append(title);
    for (const k of TURN)
      item(
        t(k.label),
        k.hint,
        () => this.edit(turnInto(this.parsed, b, k.kind), 'input.turn'),
        !canTurn(b.kind),
      );
    menu.append(el('div', 'c-editor__menu-sep'));
    item(
      t('note.block.duplicate'),
      '',
      () => this.edit(duplicateBlock(this.parsed, b), 'input.duplicate'),
      b.kind === 'frontmatter',
    );
    item(t('note.block.delete'), '', () => this.edit(deleteBlock(this.parsed, b), 'delete.block'));
    item(
      t('note.block.copy'),
      '',
      () => void navigator.clipboard?.writeText(this.view.state.sliceDoc(b.from, b.to)),
    );
    menu.addEventListener('keydown', (e) => this.menuKey(e));
    menu.style.top = `${this.handle.offsetTop + this.handle.offsetHeight}px`;
    menu.style.left = this.handle.style.left;
    this.view.scrollDOM.append(menu);
    this.menu = menu;
    this.handle.setAttribute('aria-expanded', 'true');
    const first = menu.querySelector<HTMLButtonElement>('button:not(:disabled)');
    if (keyboard) first?.focus();
    else menu.focus({ preventScroll: true });
  }

  menuKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    const items = [...(this.menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeMenu(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (n) items[(i + (e.key === 'ArrowDown' ? 1 : n - 1 + (i < 0 ? 1 : 0))) % n]!.focus();
    }
  }

  get parsed(): Parsed {
    return parsedOf(this.view.state);
  }

  edit(changes: Change[], userEvent: string) {
    if (!changes.length) return;
    this.view.dispatch({ changes, userEvent, scrollIntoView: true });
  }
}

export interface BlockHandleOptions {
  /** Read whenever a label is shown, so it follows the app language. */
  t: () => Translate;
}

export function blockHandle(opts: BlockHandleOptions): Extension {
  return [
    ViewPlugin.define((view) => new BlockHandle(view, opts.t)),
    // Above the default keymap, whose ⌥⇧↑↓ copies the line.
    Prec.high(
      keymap.of([
        { key: 'Alt-Shift-ArrowUp', run: moveStep(-1) },
        { key: 'Alt-Shift-ArrowDown', run: moveStep(1) },
      ]),
    ),
  ];
}
