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
  /** Map coloured by group (T72): biggest group first. */
  groups: string[];
}

/** Groups with a colour of their own; the rest share `missing`. */
export const GROUP_COLORS = 8;

const TOKENS: Record<Exclude<keyof GraphColors, 'groups'>, string> = {
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
  for (const k of Object.keys(TOKENS) as (keyof typeof TOKENS)[]) out[k] = css.getPropertyValue(TOKENS[k]).trim();
  out.groups = Array.from({ length: GROUP_COLORS }, (_, i) =>
    css.getPropertyValue(`--color-graph-group-${i + 1}`).trim(),
  );
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
