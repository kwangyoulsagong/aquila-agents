import type { GraphNodeKind } from '@/shared/api';

/** The semantic tokens the WebGL canvas uses, resolved to colour strings (WebGL can't read CSS variables). */
export interface GraphColors {
  note: string;
  tag: string;
  code: string;
  missing: string;
  other: string;
  edge: string;
  focus: string;
  label: string;
  surface: string;
  font: string;
}

const TOKENS: Record<keyof GraphColors, string> = {
  note: '--color-graph-note',
  tag: '--color-graph-tag',
  code: '--color-graph-code',
  missing: '--color-graph-missing',
  other: '--color-graph-other',
  edge: '--color-graph-edge',
  focus: '--color-graph-focus',
  label: '--color-text-secondary',
  surface: '--color-bg-surface',
  font: '--font-family-ui',
};

/** Reads the tokens now (call again after a theme change). */
export function readColors(el: Element = document.documentElement): GraphColors {
  const css = getComputedStyle(el);
  const out = {} as GraphColors;
  for (const k of Object.keys(TOKENS) as (keyof GraphColors)[])
    out[k] = css.getPropertyValue(TOKENS[k]).trim();
  return out;
}

export function kindColor(c: GraphColors, kind: GraphNodeKind): string {
  switch (kind) {
    case 'note':
      return c.note;
    case 'tag':
      return c.tag;
    case 'code':
    case 'file':
      return c.code;
    case 'missing':
      return c.missing;
    default:
      return c.other;
  }
}
