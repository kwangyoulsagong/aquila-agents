import { Component, createElement, lazy, Suspense, type ReactNode } from 'react';
import type { NoteEditorPanelProps, NoteSlotProps } from './ui/NoteEditorPanel';

// Note editor (T67). The panel and CodeMirror are one lazy chunk: nothing of it loads until a note is first opened.
const Panel = lazy(() => import('./ui/NoteEditorPanel'));

/** A failing editor closes itself instead of taking the terminals down with it. */
class Boundary extends Component<{ children?: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error('[note] editor failed:', e);
    this.props.onClose();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Note editor panel (right panel / full window), loaded on first open. */
export function NoteEditorPanel(props: NoteEditorPanelProps) {
  return createElement(
    Boundary,
    { onClose: props.onClose },
    createElement(Suspense, { fallback: null }, createElement(Panel, props)),
  );
}
export type { NoteEditorPanelProps, NoteSlotProps };
export { default as QuickOpen } from './ui/QuickOpen';
export { HandleWithClaude, type HandleWithClaudeProps } from './ui/HandleWithClaude';
export { handleTarget } from './model/handle';
