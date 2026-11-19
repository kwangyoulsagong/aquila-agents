import { Button } from '@design-system/react';
import type { ReactNode } from 'react';
import { api, type Config, type Session, type SessionKind } from '@/shared/api';
import { kindLabel, useT } from '@/shared/i18n';
import { endSessionDrag, startSessionDrag } from '@/shared/lib/sessionDrag';
import { SHORTCUTS, withShortcut } from '@/shared/lib/shortcuts';
import { AccountBadge } from '@/entities/project';
import { StatusDot } from '@/entities/session';

interface Props {
  config: Config;
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: (kind: SessionKind) => void;
  /** "New Claude in worktree…" in the + button's right-click menu. */
  onNewInWorktree?: () => void;
  /** Right-aligned controls (account switch). */
  trailing?: ReactNode;
}

export default function SessionTabs({
  config,
  sessions,
  activeId,
  onSelect,
  onClose,
  onNew,
  onNewInWorktree,
  trailing,
}: Props) {
  const t = useT();
  const newMenu = async () => {
    const id = await api.showContextMenu([
      { id: 'claude', label: t('action.openClaude'), accelerator: SHORTCUTS.openClaude },
      { id: 'codex', label: t('action.openCodex'), accelerator: SHORTCUTS.openCodex },
      { id: 'shell', label: t('palette.openShell'), accelerator: SHORTCUTS.openShell },
      ...(onNewInWorktree ? [{ separator: true }, { id: 'worktree', label: t('worktree.action') }] : []),
    ]);
    if (id === 'worktree') onNewInWorktree?.();
    else if (id === 'claude' || id === 'codex' || id === 'shell') onNew(id);
  };
  return (
    <div className="c-tabbar" role="tablist">
      {sessions.map((s) => (
        <div
          key={s.id}
          className="c-tab"
          role="tab"
          aria-selected={s.id === activeId}
          data-status={s.status}
          draggable
          onDragStart={(e) => startSessionDrag(e, s.id)}
          onDragEnd={endSessionDrag}
          onClick={() => onSelect(s.id)}
          onAuxClick={(e) => e.button === 1 && onClose(s.id)}
        >
          <StatusDot status={s.status} estimated={s.estimated} reason={s.reason} />
          <span className="c-tab__title">{kindLabel(t, s.kind)}</span>
          {s.worktree && (
            <span className="c-tab__branch" title={s.worktree.path}>
              {s.worktree.branch}
            </span>
          )}
          {s.account && <AccountBadge config={config} account={s.account} />}
          <button
            className="c-tab__close"
            aria-label={t('action.closeSession')}
            onClick={(e) => {
              e.stopPropagation();
              onClose(s.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <Button
        variant="ghost"
        icon
        className="c-tabbar__add"
        title={withShortcut(t('action.openClaude'), 'openClaude')}
        onClick={() => onNew('claude')}
        onContextMenu={(e) => {
          e.preventDefault();
          void newMenu();
        }}
      >
        +
      </Button>
      {trailing && <div className="c-tabbar__trailing">{trailing}</div>}
    </div>
  );
}
