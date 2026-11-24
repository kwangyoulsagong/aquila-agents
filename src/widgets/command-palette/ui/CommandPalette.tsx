import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { Palette, PaletteEmpty, PaletteItem, PaletteList } from '@design-system/react';
import type { Config, Session, SessionKind, Worktree } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { fuzzyRank } from '@/shared/lib/fuzzy';
import { AccountBadge } from '@/entities/project';
import { StatusDot } from '@/entities/session';
import { buildCommands, commandDetail, type ActionId, type Command } from '../model/commands';

interface Props {
  open: boolean;
  onClose: () => void;
  config: Config;
  sessions: Session[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  /** One handler per action that applies right now; actions without one aren't listed. */
  actions: Partial<Record<ActionId, () => void>>;
  /** Linked worktrees of the current project, each listed as Claude / Codex / Shell. */
  worktrees?: Worktree[];
  onOpenWorktree?: (branch: string, kind: SessionKind) => void;
  /** More commands to list after the actions (extensions' manifest commands, T71). */
  extra?: { id: string; label: string; run: () => void }[];
}

/** ⌘K: fuzzy-search open sessions, projects and actions; ↑↓ to pick, Enter to run, Esc to close. */
export default function CommandPalette({
  open,
  onClose,
  config,
  sessions,
  activeProjectId,
  activeSessionId,
  onSelectProject,
  onSelectSession,
  actions,
  worktrees,
  onOpenWorktree,
  extra,
}: Props) {
  const t = useT();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  // Fresh start every time it opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
    }
  }, [open]);

  const actionKeys = Object.keys(actions).join();
  const commands = useMemo(
    () =>
      buildCommands({
        config,
        sessions,
        activeProjectId,
        activeSessionId,
        available: new Set(actionKeys.split(',').filter(Boolean) as ActionId[]),
        worktrees: onOpenWorktree ? worktrees : [],
        extra,
        t,
      }),
    [config, sessions, activeProjectId, activeSessionId, actionKeys, worktrees, onOpenWorktree, extra, t],
  );
  const results = useMemo(() => fuzzyRank(commands, query, (c) => c.label, commandDetail), [commands, query]);
  const selected = Math.min(index, results.length - 1);

  const run = (c: Command) => {
    onClose();
    // After the dialog has closed and handed focus back, so the terminal that becomes active can take it.
    requestAnimationFrame(() => {
      if (c.type === 'session') onSelectSession(c.sessionId);
      else if (c.type === 'project') onSelectProject(c.projectId);
      else if (c.type === 'worktree') onOpenWorktree?.(c.branch, c.kind);
      else if (c.type === 'extra') extra?.find((x) => x.id === c.id)?.run();
      else actions[c.action]?.();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // Korean IME: Enter/arrows belong to the composition.
    const n = results.length;
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p');
    if ((down || up) && n) {
      e.preventDefault();
      setIndex((selected + (down ? 1 : n - 1)) % n);
    } else if (e.key === 'Enter' && n) {
      e.preventDefault();
      run(results[selected].item);
    }
  };

  const optionId = (i: number) => `${baseId}-opt-${i}`;

  return (
    <Palette
      open={open}
      onClose={onClose}
      label={t('palette.title')}
      query={query}
      onQueryChange={(q) => {
        setQuery(q);
        setIndex(0);
      }}
      placeholder={t('palette.placeholder')}
      onKeyDown={onKeyDown}
      listId={listId}
      activeId={results.length ? optionId(selected) : undefined}
      footer={
        <>
          <span>{t('palette.move')}</span>
          <span>{t('palette.run')}</span>
          <span>{t('palette.close')}</span>
        </>
      }
    >
      {results.length === 0 ? (
        <PaletteEmpty>{t('palette.empty')}</PaletteEmpty>
      ) : (
        <PaletteList id={listId}>
          {results.map(({ item: c, indices }, i) => (
            <PaletteItem
              key={c.id}
              id={optionId(i)}
              selected={i === selected}
              label={c.label}
              marks={indices}
              onSelect={() => run(c)}
              onHover={() => setIndex(i)}
              {...itemDecor(c, config)}
            />
          ))}
        </PaletteList>
      )}
    </Palette>
  );
}

function itemDecor(c: Command, config: Config) {
  switch (c.type) {
    case 'session':
      return {
        leading: <StatusDot status={c.status} />,
        hint: c.account ? <AccountBadge config={config} account={c.account} /> : undefined,
      };
    case 'project':
      return { leading: <StatusDot status={c.status} />, hint: c.hint };
    case 'worktree':
      return { hint: c.hint };
    case 'action':
      return { kbd: c.kbd };
    case 'extra':
      return {};
  }
}
