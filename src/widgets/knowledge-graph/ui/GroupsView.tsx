import { useLayoutEffect, useMemo, useState } from 'react';
import { GraphGroups, type GroupBubble, type GroupLinkLine } from '@design-system/react';
import { useT } from '@/shared/i18n';
import { bubbleLayout, HERE, MORE, type GroupItem, type GroupLink } from '../model/groups';

export interface GroupsViewProps {
  items: GroupItem[];
  links: GroupLink[];
  /** The folder this level is in (names the "directly here" group). */
  parent: string | null;
  /** A lens is on: its hits, to count per group. */
  hits: ReadonlySet<string> | null;
  /** Nodes changed in the last 7 days ("+3 this week" under a group). */
  recent: ReadonlySet<string>;
  /** Groups picked with ⌘-click, to be shown together. */
  picked: ReadonlySet<string>;
  onOpen: (key: string) => void;
  /** ⌘ / Shift-click: pick or unpick. */
  onToggle: (key: string) => void;
}

/** Links drawn per group at rest (the rest show on hover). */
const STRONGEST = 2;

/** Radii from the tokens (read once per mount). */
function readRadii(el: Element) {
  const css = getComputedStyle(el);
  const px = (name: string, fallback: number) => parseFloat(css.getPropertyValue(name)) || fallback;
  return {
    min: px('--size-bubble-min', 24),
    max: px('--size-bubble-max', 64),
    pad: px('--space-stack-lg', 24),
  };
}

/** Group name for the UI: kinds translated, "directly here" and "N more" spelled out. */
export function useGroupLabel(): (item: Pick<GroupItem, 'seg' | 'folded'>, parent: string | null) => string {
  const t = useT();
  return (item, parent) =>
    item.seg.key === MORE
      ? t('graph.groups.more', { n: String(item.folded ?? 0) })
      : item.seg.key === HERE
        ? t('graph.groups.here', { name: parent ?? '' })
        : item.seg.kind
          ? t(`graph.kind.${item.seg.kind}`)
          : item.seg.label;
}

/**
 * The Map's groups (T73): bubbles on a ring, linked groups side by side, line width by how many links run between
 * two groups. Hovering a group lights its lines with their counts; click / Enter opens it.
 */
export function GroupsView({
  items,
  links,
  parent,
  hits,
  recent,
  picked,
  onOpen,
  onToggle,
}: GroupsViewProps) {
  const t = useT();
  const labelOf = useGroupLabel();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (!host) return;
    const read = () => setSize({ width: host.clientWidth, height: host.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(host);
    return () => ro.disconnect();
  }, [host]);
  const radii = useMemo(() => (host ? readRadii(host) : null), [host]);
  // Narrow panel: smaller bubbles, so the ring still fits.
  const fit = radii && {
    ...radii,
    max: Math.max(radii.min, Math.min(radii.max, Math.min(size.width, size.height) / 7)),
  };
  const boxes = useMemo(
    () => (fit && size.width ? bubbleLayout(items, links, size.width, size.height, fit) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, links, size.width, size.height, fit?.max],
  );
  const at = new Map(boxes.map((b) => [b.key, b]));
  const linked = new Set<string>();
  if (hovered)
    for (const l of links) {
      if (l.a === hovered) linked.add(l.b);
      if (l.b === hovered) linked.add(l.a);
    }
  const most = Math.max(1, ...links.map((l) => l.count));
  // Every pair linked drew a hairball of lines again: at rest, only each group's strongest links; hovering a group
  // shows all of its own.
  const strong = useMemo(() => {
    const keep = new Set<GroupLink>();
    for (const it of items)
      links
        .filter((l) => l.a === it.key || l.b === it.key)
        .sort((x, y) => y.count - x.count)
        .slice(0, STRONGEST)
        .forEach((l) => keep.add(l));
    return keep;
  }, [items, links]);
  const lines: GroupLinkLine[] = links.flatMap((l) => {
    if (!strong.has(l) && !(hovered && (l.a === hovered || l.b === hovered))) return [];
    const a = at.get(l.a);
    const b = at.get(l.b);
    if (!a || !b) return [];
    const lit = !!hovered && (l.a === hovered || l.b === hovered);
    // From edge to edge: a line through the (translucent) bubbles read as more links.
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len <= a.r + b.r) return [];
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    return [
      {
        id: `${l.a}\0${l.b}`,
        x1: a.x + ux * a.r,
        y1: a.y + uy * a.r,
        x2: b.x - ux * b.r,
        y2: b.y - uy * b.r,
        width: 1 + 5 * Math.sqrt(l.count / most),
        label: String(l.count),
        lit,
        dim: !!hovered && !lit,
      },
    ];
  });
  const bubbles: GroupBubble[] = items.flatMap((it) => {
    const b = at.get(it.key);
    if (!b) return [];
    const name = labelOf(it, parent);
    const n = hits ? it.ids.filter((id) => hits.has(id)).length : undefined;
    const fresh = it.ids.filter((id) => recent.has(id)).length;
    return [
      {
        ...b,
        label: name,
        count: String(it.ids.length),
        ...(fresh ? { detail: t('graph.groups.recent', { n: String(fresh) }) } : {}),
        group: it.colour,
        ...(n !== undefined ? { hits: n } : {}),
        dim: !!hovered && hovered !== it.key && !linked.has(it.key),
        selected: picked.has(it.key),
        title: t('graph.groups.open', { name, n: String(it.ids.length) }),
      },
    ];
  });
  return (
    <GraphGroups
      hostRef={setHost}
      width={size.width}
      height={size.height}
      label={t('graph.groups.label')}
      bubbles={bubbles}
      links={lines}
      onPick={(key, multi) => (multi ? onToggle(key) : onOpen(key))}
      hint={t('graph.groups.hint')}
      onHover={setHovered}
    />
  );
}
