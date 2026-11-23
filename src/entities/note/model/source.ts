import type { DotStatus } from '@design-system/react';
import type { GraphSourceState, GraphSourceStatus } from '@/shared/api';
import type { Translate } from '@/shared/i18n';

/** Folder name of a source path (`~/Notes/Meetings` → `Meetings`). */
export function sourceName(p: string): string {
  const parts = p.split(/[/\\]+/).filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

const DOT: Record<GraphSourceState, DotStatus> = {
  off: 'stopped',
  indexing: 'working',
  ready: 'done',
  paused: 'waiting',
  missing: 'error',
  error: 'error',
};

export const sourceDot = (state: GraphSourceState): DotStatus => DOT[state];

/** One line under the source name: what it's doing or how many notes it has. */
export function sourceLine(t: Translate, s: GraphSourceStatus): string {
  switch (s.state) {
    case 'indexing':
      return s.total
        ? t('sources.state.indexingCount', { done: String(s.notes), total: String(s.total) })
        : t('sources.state.indexing');
    case 'ready':
      return t('sources.state.ready', { count: String(s.notes) });
    case 'paused':
      return t('sources.state.paused', { total: String(s.total ?? 0) });
    case 'error':
      return t('sources.state.error', { error: s.error ?? '' });
    default:
      return t(`sources.state.${s.state}`);
  }
}
