import { Component, createElement, lazy, Suspense, type ReactNode } from 'react';
import type { KnowledgeGraphPanelProps } from './ui/KnowledgeGraphPanel';

// The panel, sigma.js, graphology and the layout are one lazy chunk: nothing of it loads until the panel first opens.
const Panel = lazy(() => import('./ui/KnowledgeGraphPanel'));

/** A failing graph (WebGL lost, a bad index) closes itself instead of taking the terminals down with it. */
class Boundary extends Component<{ children?: ReactNode; onClose: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.error('[graph] panel failed:', e);
    this.props.onClose();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Knowledge graph panel (T66), loaded on first open. */
export function KnowledgeGraphPanel(props: KnowledgeGraphPanelProps) {
  return createElement(
    Boundary,
    { onClose: props.onClose },
    createElement(Suspense, { fallback: null }, createElement(Panel, props)),
  );
}
export type { KnowledgeGraphPanelProps };
