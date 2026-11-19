import { useEffect, useState, type CSSProperties, type DragEvent } from 'react';
import type { Config, Project, Session, SessionKind } from '@/shared/api';
import { kindLabel, useT } from '@/shared/i18n';
import { draggedSession, endSessionDrag } from '@/shared/lib/sessionDrag';
import { AccountBadge } from '@/entities/project';
import { StatusDot, TerminalView } from '@/entities/session';
import { OpenSessionPanel } from '@/features/open-session';
import {
  MAX_PANES,
  paneOf,
  rects,
  zoneAt,
  zoneRect,
  type DropZone,
  type Layout,
  type PaneRect,
} from '../model/layout';

interface Props {
  config: Config;
  sessions: Session[];
  layout: Layout;
  /** Active project: what an empty pane offers to open. */
  project: Project | undefined;
  onOpen: (kind: SessionKind) => void;
  onFocusPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onDropSession: (sessionId: string, paneId: string, zone: DropZone) => void;
}

type Box = Pick<PaneRect, 'x' | 'y' | 'w' | 'h'>;

const pct = (n: number) => `${+(n * 100).toFixed(4)}%`;
/** Position a box on the stage; panes after the first get a 1px hairline gap (the stage background). */
function place(r: Box, inset = '0px', head = false): CSSProperties {
  const edge = (start: number) => (start > 0 ? `calc(${pct(start)} + 1px + ${inset})` : inset);
  return {
    left: edge(r.x),
    top: head ? `calc(${edge(r.y)} + var(--size-pane-head))` : edge(r.y),
    right: `calc(${pct(1 - r.x - r.w)} + ${inset})`,
    bottom: `calc(${pct(1 - r.y - r.h)} + ${inset})`,
  };
}

/**
 * Panes laid out from the split tree. Terminals are NOT children of panes: every session stays mounted in
 * one flat list and is positioned over its pane, so re-splitting never remounts xterm (scrollback survives).
 */
export default function SplitView({
  config,
  sessions,
  layout,
  project,
  onOpen,
  onFocusPane,
  onClosePane,
  onDropSession,
}: Props) {
  const t = useT();
  const [dropTarget, setDropTarget] = useState<{ rect: PaneRect; zone: DropZone } | null>(null);
  const panes = rects(layout.root);
  const split = panes.length > 1;
  const byId = new Map(sessions.map((s) => [s.id, s]));

  // A cancelled drag (Esc, dropped elsewhere) must not leave the indicator behind.
  useEffect(() => {
    const clear = () => setDropTarget(null);
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, []);

  const targetAt = (e: DragEvent<HTMLElement>, sessionId: string) => {
    const box = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    const rect = panes.find((r) => fx >= r.x && fx <= r.x + r.w && fy >= r.y && fy <= r.y + r.h);
    if (!rect) return null;
    let zone = zoneAt((fx - rect.x) / rect.w, (fy - rect.y) / rect.h);
    // A new pane only fits below the limit — unless the session is moving out of another pane.
    if (zone !== 'center' && panes.length >= MAX_PANES && !paneOf(layout, sessionId)) zone = 'center';
    return { rect, zone };
  };

  const onDragOver = (e: DragEvent<HTMLElement>) => {
    const id = draggedSession(e);
    const target = id && targetAt(e, id);
    if (!target) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (target.rect.leaf.id !== dropTarget?.rect.leaf.id || target.zone !== dropTarget.zone)
      setDropTarget(target);
  };
  const onDragLeave = (e: DragEvent<HTMLElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
  };
  const onDrop = (e: DragEvent<HTMLElement>) => {
    const id = draggedSession(e);
    const target = id && targetAt(e, id);
    setDropTarget(null);
    endSessionDrag();
    if (!id || !target) return;
    e.preventDefault();
    onDropSession(id, target.rect.leaf.id, target.zone);
  };

  return (
    <div
      className="app__stage c-split c-split--free"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {panes.map((r) => {
        const s = r.leaf.sessionId ? byId.get(r.leaf.sessionId) : undefined;
        const p = s && config.projects.find((x) => x.id === s.projectId);
        return (
          <section
            key={r.leaf.id}
            className="c-pane"
            data-focused={split && r.leaf.id === layout.focusedId}
            style={place(r)}
            onMouseDown={() => onFocusPane(r.leaf.id)}
          >
            {split && (
              <div className="c-pane__head">
                {s ? (
                  <>
                    <StatusDot status={s.status} />
                    <span className="c-pane__title">
                      {kindLabel(t, s.kind)} · {p?.name ?? s.projectId}
                    </span>
                    {s.account && <AccountBadge config={config} account={s.account} />}
                  </>
                ) : (
                  <span className="c-pane__title">{t('pane.empty')}</span>
                )}
                <button
                  className="c-pane__close"
                  aria-label={t('action.closePane')}
                  title={t('action.closePane')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onClosePane(r.leaf.id)}
                >
                  ×
                </button>
              </div>
            )}
            {!s && <OpenSessionPanel project={project} onOpen={onOpen} />}
          </section>
        );
      })}

      {sessions.map((s) => {
        const r = panes.find((x) => x.leaf.sessionId === s.id);
        return (
          <div
            key={s.id}
            className="term-host"
            hidden={!r}
            style={r && place(r, split ? '1px' : '0px', split)}
            onMouseDownCapture={() => r && onFocusPane(r.leaf.id)}
            onFocusCapture={() => r && onFocusPane(r.leaf.id)}
          >
            <TerminalView id={s.id} visible={!!r} focused={r?.leaf.id === layout.focusedId} />
          </div>
        );
      })}

      {dropTarget && (
        <div
          className="c-split__drop"
          data-zone={dropTarget.zone}
          style={place(zoneRect(dropTarget.rect, dropTarget.zone))}
        />
      )}
    </div>
  );
}
