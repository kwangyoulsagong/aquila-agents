import { Button, RiskMark } from '@design-system/react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { api, type Config, type Session, type SessionKind, type Worktree } from '@/shared/api';
import { kindLabel, sessionTitle, useT } from '@/shared/i18n';
import { isDestructive } from '@/shared/lib/risk';
import { draggedSession, endSessionDrag, startSessionDrag } from '@/shared/lib/sessionDrag';
import { accelerator, withShortcut } from '@/shared/lib/shortcuts';
import { parseWorktreeMenuId, worktreeMenuItems } from '@/features/open-in-worktree';
import { SessionTitle } from '@/features/rename-session';
import { AccountBadge, HostBadge } from '@/entities/project';
import {
  ContextGauge,
  KindBadge,
  StatusDot,
  WaitingTime,
  dropSide,
  moveSession,
  type DropSide,
} from '@/entities/session';

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
  /** The tab whose title is being edited (T43), and how to start / end that. */
  renamingId?: string | null;
  onRename?: (id: string | null) => void;
  /** A tab dragged along the bar was dropped before / after another one. */
  onReorder?: (id: string, targetId: string, side: DropSide) => void;
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
  renamingId = null,
  onRename = () => {},
  onReorder,
}: Props) {
  const t = useT();
  const newKind = NEW_BUTTON[defaultKind];
  const barRef = useRef<HTMLDivElement>(null);
  // Drag to reorder: the tab being dragged and where it would land (drawn as a line on that edge of the target tab).
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: DropSide } | null>(null);
  const endDrag = () => {
    endSessionDrag();
    setDraggingId(null);
    setDrop(null);
  };
  /** Where a tab dragged over `targetId` would go; null when it's another drag or the drop would change nothing. */
  const dropAt = (e: DragEvent<HTMLElement>, targetId: string) => {
    const dragged = onReorder ? draggedSession(e) : null;
    if (!dragged) return null;
    const side = dropSide(e.clientX, e.currentTarget.getBoundingClientRect());
    return moveSession(sessions, dragged, targetId, side) === sessions ? null : { dragged, side };
  };
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
      {sessions.map((s) => {
        const title = sessionTitle(t, s);
        const renaming = renamingId === s.id;
        // T52: what it waits on (or the last answer) on hover; a destructive command gets a mark.
        const detail = s.status === 'waiting' || s.status === 'done' ? s.detail : undefined;
        const risky = s.status === 'waiting' && isDestructive(detail);
        return (
          <div
            key={s.id}
            className="c-tab"
            role="tab"
            aria-selected={s.id === activeId}
            data-status={s.status}
            data-dragging={draggingId === s.id || undefined}
            data-drop={drop?.id === s.id ? drop.side : undefined}
            title={detail && !renaming ? `${title} — ${detail}` : undefined}
            draggable={!renaming}
            onDragStart={(e) => {
              startSessionDrag(e, s.id);
              setDraggingId(s.id);
            }}
            onDragEnd={endDrag}
            onDragOver={(e) => {
              if (!onReorder || !draggedSession(e)) return;
              // A tab dragged over a tab is a reorder; a spot where it would change nothing shows no line.
              e.preventDefault();
              const at = dropAt(e, s.id);
              e.dataTransfer.dropEffect = at ? 'move' : 'none';
              if (!at) return setDrop((d) => (d?.id === s.id ? null : d));
              if (drop?.id !== s.id || drop.side !== at.side) setDrop({ id: s.id, side: at.side });
            }}
            onDragLeave={(e) => {
              if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
              setDrop((d) => (d?.id === s.id ? null : d));
            }}
            onDrop={(e) => {
              const at = dropAt(e, s.id);
              if (!at) return;
              e.preventDefault();
              endDrag();
              onReorder?.(at.dragged, s.id, at.side);
            }}
            onClick={() => onSelect(s.id)}
            onAuxClick={(e) => e.button === 1 && onClose(s.id)}
          >
            <StatusDot status={s.status} estimated={s.estimated} reason={s.reason} />
            {/* The kind is a badge in front of a title of its own; a tab titled by its kind needs no badge. */}
            {(renaming || title !== kindLabel(t, s.kind)) && <KindBadge kind={s.kind} />}
            <SessionTitle
              className="c-tab__title"
              session={s}
              editing={renaming}
              onEdit={() => {
                onSelect(s.id);
                onRename(s.id);
              }}
              onDone={() => onRename(null)}
            />
            {s.worktree && !renaming && s.worktree.branch !== title && (
              <span className="c-tab__branch" title={s.worktree.path}>
                {s.worktree.branch}
              </span>
            )}
            {risky && <RiskMark label={t('attention.risky')} />}
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
        );
      })}
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
