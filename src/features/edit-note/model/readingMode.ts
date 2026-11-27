import { Compartment, EditorState, Facet, Prec, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

// T82 reading mode: the note as a finished document. Read-only, and every Markdown mark hidden even where the
// cursor is (the live preview treats no line as "active"). Checkbox clicks still edit (one character, saved like
// typing) and links still open. Toggled from the panel head or ⌘E; remembered.

const readingFacet = Facet.define<boolean, boolean>({ combine: (v) => v.some(Boolean) });

/** True while the editor is in reading mode. */
export const isReading = (state: EditorState): boolean => state.facet(readingFacet);

export const readingCompartment = new Compartment();

export function reading(on: boolean): Extension {
  if (!on) return [];
  return [
    readingFacet.of(true),
    EditorState.readOnly.of(true),
    // `editable` takes its first value: highest precedence beats the read-only compartment's `editable: true`.
    Prec.highest(EditorView.editable.of(false)),
    // Still focusable (⌘E back, ⌘F find, text selection) though not editable.
    EditorView.contentAttributes.of({ tabindex: '0' }),
    EditorView.editorAttributes.of({ class: 'cm-reading' }),
  ];
}

/** ⌘E on macOS, Ctrl+E elsewhere, no other modifier. */
export const READING_ACCELERATOR = 'CommandOrControl+E';
export function isReadingKey(
  e: Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>,
  mac: boolean,
): boolean {
  return (
    e.code === 'KeyE' && !e.shiftKey && !e.altKey && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)
  );
}

const KEY = 'aquila.note.reading';
export function readReading(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export function writeReading(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // not remembered: editing next time
  }
}
