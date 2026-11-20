import { Button } from '@design-system/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { api, type Config, type Session, type SessionKind, type Worktree } from '@/shared/api';
import { kindLabel, useT } from '@/shared/i18n';
import { endSessionDrag, startSessionDrag } from '@/shared/lib/sessionDrag';
import { accelerator, withShortcut } from '@/shared/lib/shortcuts';
import { parseWorktreeMenuId, worktreeMenuItems } from '@/features/open-in-worktree';
import { AccountBadge, HostBadge } from '@/entities/project';
import { ContextGauge, StatusDot, WaitingTime } from '@/entities/session';

interface Props {
  config: Config;
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: (kind: SessionKind) => void;
  /** What a click on + opens (the project's default agent; Claude when unset). */
  defaultKind?: SessionKind;
  /** Worktree entries in the + button's right-click menu (local git projects): "Open in worktree…" opens the dialog. */
  worktrees?: {
    /** The project's existing linked worktrees, read when the menu opens. */
    load: () => Promise<Worktree[]>;
    onDialog: () => void;
    onOpen: (branch: string, kind: SessionKind) => void;
    onCleanup: () => void;
  };
  /** Right-aligned controls (account switch). */
  trailing?: ReactNode;
}

/** Tooltip of + per default agent. */
const NEW_BUTTON = {
  claude: { key: 'action.openClaude', shortcut: 'openClaude' },
  codex: { key: 'action.openCodex', shortcut: 'openCodex' },
  shell: { key: 'palette.openShell', shortcut: 'openShell' },
} as const;

export default function SessionTabs({
  config,
  sessions,
  activeId,
  onSelect,
  onClose,
  onNew,
  defaultKind = 'claude',
  worktrees,
  trailing,
}: Props) {
  const t = useT();
  const newKind = NEW_BUTTON[defaultKind];
  const barRef = useRef<HTMLDivElement>(null);
  // A full bar scrolls sideways: keep the selected tab in view, clear of the pinned trailing controls.
  useEffect(() => {
    const bar = barRef.current;
    const tab = bar?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!bar || !tab) return;
    const trailing = bar.querySelector<HTMLElement>('.c-tabbar__trailing');
    const right = trailing ? trailing.getBoundingClientRect().left : bar.getBoundingClientRect().right;
    // The last tab brings the + button (right after it) into view too.
    const next = tab.nextElementSibling;
    const r = tab.getBoundingClientRect();
    const end =
      next instanceof HTMLElement && next.classList.contains('c-tabbar__add')
        ? next.getBoundingClientRect().right
        : r.right;
    const left = bar.getBoundingClientRect().left;
    if (end > right) bar.scrollLeft += end - right;
    else if (r.left < left) bar.scrollLeft -= left - r.left;
  }, [activeId, sessions.length]);
  const newMenu = async () => {
    const existing = worktrees ? await worktrees.load() : [];
    const id = await api.showContextMenu([
      { id: 'claude', label: t('action.openClaude'), accelerator: accelerator('openClaude') },
      { id: 'codex', label: t('action.openCodex'), accelerator: accelerator('openCodex') },
      { id: 'shell', label: t('palette.openShell'), accelerator: accelerator('openShell') },
      ...(worktrees
        ? [
            { separator: true },
            ...(existing.length
              ? [{ label: t('worktree.existing'), submenu: worktreeMenuItems(t, existing) }]
              : []),
            { id: 'worktree', label: t('worktree.action') },
            ...(existing.length ? [{ id: 'worktree-cleanup', label: t('worktree.cleanup') }] : []),
          ]
        : []),
    ]);
    const picked = parseWorktreeMenuId(id);
    if (picked) worktrees?.onOpen(picked.branch, picked.kind);
    else if (id === 'worktree') worktrees?.onDialog();
    else if (id === 'worktree-cleanup') worktrees?.onCleanup();
    else if (id === 'claude' || id === 'codex' || id === 'shell') onNew(id);
  };
  return (
    <div ref={barRef} className="c-tabbar" role="tablist">
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
          {s.status === 'waiting' && <WaitingTime since={s.since} />}
          {s.kind === 'claude' && !s.remote && <ContextGauge id={s.id} />}
          {s.account && <AccountBadge config={config} account={s.account} />}
          {s.remote && <HostBadge host={s.remote} conn={s.connection ?? 'connecting'} />}
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
        title={withShortcut(t(newKind.key), newKind.shortcut)}
        onClick={() => onNew(defaultKind)}
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
