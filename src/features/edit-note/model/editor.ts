import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewline } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state';
import { EditorView, keymap, type Command } from '@codemirror/view';
import type { LinkOption } from './links';
import { livePreview } from './livePreview';
import { documentHeader } from './document';
import { reading, readingCompartment } from './readingMode';
import { continueMarkup, newRow, nextCell, prevCell } from './tables';

// The editor's extensions in one place. No closing brackets, no reindent on Enter beyond Markdown's list
// continuation, no format on save: lines the user didn't touch never change.

export interface EditorOptions {
  /** Read when `[[` is typed, so it follows the index without rebuilding the editor. */
  links: () => LinkOption[];
  onOpenLink: (target: string) => void;
  onOpenUrl: (url: string) => void;
  imageSrc: (target: string) => string | null;
  onSave: () => void;
  onBlur: () => void;
  /** A pasted image: save it and return the Markdown to insert (or null to drop it). */
  onPasteImage: (file: File) => Promise<string | null>;
  placeholder?: string;
}

/** Wraps a table command (state → transaction) as a key command. Never runs while an IME is composing. */
const tableKey =
  (cmd: typeof nextCell): Command =>
  (view) => {
    if (view.composing) return false;
    const tr = cmd(view.state);
    if (!tr) return false;
    view.dispatch(tr);
    return true;
  };

function linkCompletion(links: () => LinkOption[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/\[\[[^\]|#\n]*$/);
    if (!before) return null;
    const from = before.from + 2;
    const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]';
    return {
      from,
      validFor: /^[^\]|#\n]*$/,
      options: links().map((o) => ({
        label: o.label,
        ...(o.detail ? { detail: o.detail } : {}),
        apply: closed ? o.insert : `${o.insert}]]`,
        type: 'text',
      })),
    };
  };
}

export const readOnlyCompartment = new Compartment();

export function readOnly(on: boolean): Extension {
  return [EditorState.readOnly.of(on), EditorView.editable.of(!on)];
}

export function editorExtensions(opts: EditorOptions): Extension {
  return [
    history(),
    // No Markdown keymap: its Enter renumbers the list items below the cursor.
    markdown({ base: markdownLanguage, addKeymap: false }),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
    search({ top: true }),
    autocompletion({ override: [linkCompletion(opts.links)], icons: false, activateOnTyping: true }),
    livePreview({ onOpenLink: opts.onOpenLink, onOpenUrl: opts.onOpenUrl, imageSrc: opts.imageSrc }),
    readOnlyCompartment.of(readOnly(false)),
    // T82: reading mode (off until the panel turns it on) and the document header above the text.
    readingCompartment.of(reading(false)),
    documentHeader(),
    Prec.high(
      keymap.of([
        { key: 'Tab', run: tableKey(nextCell) },
        { key: 'Shift-Tab', run: tableKey(prevCell) },
        { key: 'Enter', run: tableKey(newRow) },
        { key: 'Enter', run: tableKey(continueMarkup) },
        {
          key: 'Mod-s',
          run: () => {
            opts.onSave();
            return true;
          },
          preventDefault: true,
        },
      ]),
    ),
    // Plain newline: no reindent, no trailing-space cleanup on the line being left.
    keymap.of([{ key: 'Enter', run: insertNewline }, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
    EditorView.domEventHandlers({
      blur: () => {
        opts.onBlur();
        return false;
      },
      paste: (e, view) => {
        const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
        if (!file || view.state.readOnly) return false;
        e.preventDefault();
        void opts.onPasteImage(file).then((md) => {
          if (!md) return;
          const { from, to } = view.state.selection.main;
          view.dispatch({
            changes: { from, to, insert: md },
            selection: { anchor: from + md.length },
            userEvent: 'input.paste',
          });
        });
        return true;
      },
    }),
  ];
}
