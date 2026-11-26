import { useState } from 'react';
import { Button, EmptyState, WeekBurst, WeekDay, WeekItem, WeekList } from '@design-system/react';
import type { GraphNode } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { dayLabel, isBurst, type WeekItem as Item, type WeekList as List } from '../model/week';
import { nodeLabel, swatchOf } from './FocusView';
import type { LiveSession } from './useLiveSessions';

export interface WeekViewProps {
  list: List;
  /** "This tab": the empty state says why. */
  tab: boolean;
  live: ReadonlyMap<string, LiveSession>;
  /** A note's place (`requirements/specs`), for its meta line. */
  placeOf: (n: GraphNode) => string | undefined;
  onOpen: (n: GraphNode) => void;
  onAround: (id: string) => void;
}

/**
 * "This week" (T74): what changed, newest first, by day. A row opens the thing (a note in the editor, a session's
 * tab or resumed); "Around" puts it in the middle of the graph.
 */
export function WeekView({ list, tab, live, placeOf, onOpen, onAround }: WeekViewProps) {
  const t = useT();
  /** Bursts opened (`<day>:<minute>`). */
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const now = Date.now();
  const locale = t('locale');
  const count = (n: number, key: 'graph.week.notes' | 'graph.week.sessions' | 'graph.week.files') =>
    n ? t(key, { n: String(n) }) : '';
  const detailOf = (it: Item): string => {
    const n = it.node;
    switch (n.kind) {
      case 'note':
        return [placeOf(n)?.split('/').slice(0, -1).join('/'), count(it.sessions, 'graph.week.sessions')]
          .filter(Boolean)
          .join(' · ');
      case 'session': {
        const agent = /^session:(claude|codex):/.exec(n.id)?.[1];
        return [
          agent === 'codex' ? 'Codex' : agent === 'claude' ? 'Claude' : '',
          count(it.notes, 'graph.week.notes'),
          count(it.files, 'graph.week.files'),
        ]
          .filter(Boolean)
          .join(' · ');
      }
      case 'file':
        return n.label.split('/').slice(0, -1).join('/') || t('graph.one.file');
      default:
        return t(`graph.kind.${n.kind}`);
    }
  };
  const timeOf = (ms: number) =>
    new Date(ms).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  /** "노트 214 · salt-server/requirements": what kinds, and the folder they share (if any). */
  const burstDetail = (items: Item[]): string => {
    const kinds = (['note', 'file', 'session', 'other'] as const)
      .map((k) => [k, items.filter((i) => i.kind === k).length] as const)
      .filter(([, n]) => n)
      .map(([k, n]) => `${k === 'other' ? t('graph.week.other') : t(`graph.kind.${k}`)} ${n}`);
    const dirs = items.map((i) => (placeOf(i.node) ?? '').split('/').slice(0, -1));
    const shared: string[] = [];
    for (let k = 0; dirs.every((x) => x[k] !== undefined && x[k] === dirs[0]![k]); k++)
      shared.push(dirs[0]![k]!);
    return [...kinds, shared.join('/')].filter(Boolean).join(' · ');
  };
  const row = (it: Item) => {
    const tabNow = live.get(it.node.id);
    return (
      <WeekItem
        key={it.node.id}
        kind={swatchOf(it.node.kind)}
        label={nodeLabel(it.node)}
        detail={detailOf(it)}
        {...(tabNow ? { live: t(`graph.live.${tabNow.status}`) } : {})}
        time={timeOf(it.node.mtime!)}
        onOpen={() => onOpen(it.node)}
        side={
          <Button variant="ghost" onClick={() => onAround(it.node.id)} title={t('graph.week.aroundHint')}>
            {t('graph.mode.focus')}
          </Button>
        }
      />
    );
  };
  if (!list.days.length) return <EmptyState title={t(tab ? 'graph.week.tabNone' : 'graph.week.empty')} />;
  return (
    <WeekList label={t('graph.mode.week')}>
      {list.days.map((d) => (
        <WeekDay key={d.start} title={dayLabel(d.start, now, t, locale)} count={d.count}>
          {d.rows.map((r) => {
            if (!isBurst(r)) return row(r);
            const key = `${d.start}:${r.at}`;
            const open = opened.has(key);
            return (
              <WeekBurst
                key={key}
                label={t('graph.week.burst', { n: String(r.items.length) })}
                detail={burstDetail(r.items)}
                time={timeOf(r.at)}
                open={open}
                onToggle={() =>
                  setOpened((o) => {
                    const next = new Set(o);
                    if (open) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              >
                {open && r.items.map(row)}
              </WeekBurst>
            );
          })}
        </WeekDay>
      ))}
    </WeekList>
  );
}
