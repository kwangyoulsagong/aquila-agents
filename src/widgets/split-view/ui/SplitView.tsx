import { useEffect, useState, type CSSProperties, type DragEvent, type PointerEvent } from 'react';
import type { Config, Project, Session, SessionKind } from '@/shared/api';
import { kindLabel, useT } from '@/shared/i18n';
import { draggedSession, endSessionDrag } from '@/shared/lib/sessionDrag';
import { AccountBadge, HostBadge } from '@/entities/project';
import { StatusDot, TerminalView } from '@/entities/session';
import { TerminalHelpers } from '@/features/terminal-helpers';
import { TerminalSearch } from '@/features/terminal-search';
import { FigmaChips } from '@/features/figma';
import { ConnectionBanner } from '@/features/remote-connection';
import { OpenSessionPanel } from '@/features/open-session';
import { withShortcut } from '@/shared/lib/shortcuts';
import {
  dividers,
  MAX_PANES,
  paneOf,
  resize,
  visibleRects,
  zoneAt,
  zoneRect,
  zoomed,
  type Divider,
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
  onToggleZoom: () => void;
  /** Commit a divider drag: the split at `path` gets `ratio`. */
  onResize: (path: string, ratio: number) => void;
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

/** A divider's grab area, centred on the hairline between the two sides of its split. */
function dividerStyle(d: Divider): CSSProperties {
  const half = 'var(--size-split-handle) / 2';
  return d.dir === 'row'
    ? {
        left: `calc(${pct(d.x + d.w * d.ratio)} - ${half} + 0.5px)`,
        top: pct(d.y),
        bottom: pct(1 - d.y - d.h),
      }
    : {
        top: `calc(${pct(d.y + d.h * d.ratio)} - ${half} + 0.5px)`,
        left: pct(d.x),
        right: pct(1 - d.x - d.w),
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
  onToggleZoom,
  onResize,
}: Props) {
  const t = useT();
  const [dropTarget, setDropTarget] = useState<{ rect: PaneRect; zone: DropZone } | null>(null);
  /** A divider being dragged: the layout shows the new ratio live, it's committed on release. */
  const [drag, setDrag] = useState<{ path: string; ratio: number; dir: Divider['dir'] } | null>(null);
  const shown = drag ? resize(layout, drag.path, drag.ratio) : layout;
  const panes = visibleRects(shown);
  const isZoomed = !!zoomed(layout);
  /** More than one pane in the tree (zoomed or not): panes get a head. */
  const split = shown.root.kind === 'split';
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

  const startResize = (e: PointerEvent<HTMLElement>, d: Divider) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const stage = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!stage) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const ratioAt = (ev: { clientX: number; clientY: number }) =>
      d.dir === 'row'
        ? ((ev.clientX - stage.left) / stage.width - d.x) / d.w
        : ((ev.clientY - stage.top) / stage.height - d.y) / d.h;
    let last = d.ratio;
    setDrag({ path: d.path, ratio: last, dir: d.dir });
    const move = (ev: globalThis.PointerEvent) => {
      last = ratioAt(ev);
      setDrag({ path: d.path, ratio: last, dir: d.dir });
    };
    const end = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      setDrag(null);
      onResize(d.path, last);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };

  return (
    <div
      className="app__stage c-split c-split--free"
      data-resizing={drag?.dir}
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
            data-zoomed={isZoomed || undefined}
            style={place(r)}
            onMouseDown={() => onFocusPane(r.leaf.id)}
          >
            {split && (
              <div className="c-pane__head" onDoubleClick={onToggleZoom}>
                {s ? (
                  <>
                    <StatusDot status={s.status} estimated={s.estimated} reason={s.reason} />
                    <span className="c-pane__title">
                      {kindLabel(t, s.kind)} · {p?.name ?? s.projectId}
                      {s.worktree && ` · ${s.worktree.branch}`}
                    </span>
                    {s.account && <AccountBadge config={config} account={s.account} />}
                    {s.remote && <HostBadge host={s.remote} conn={s.connection ?? 'connecting'} />}
                  </>
                ) : (
                  <span className="c-pane__title">{t('pane.empty')}</span>
                )}
                <button
                  className="c-pane__zoom"
                  aria-pressed={isZoomed}
                  aria-label={t('action.zoomPane')}
                  title={withShortcut(t('action.zoomPane'), 'zoomPane')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={() => {
                    onFocusPane(r.leaf.id);
                    onToggleZoom();
                  }}
                >
                  {isZoomed ? '⤡' : '⤢'}
                </button>
                <button
                  className="c-pane__close"
                  aria-label={t('action.closePane')}
                  title={t('action.closePane')}
                  onMouseDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
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

      {/* A dormant restored tab gets its terminal once it's started (on first show). */}
      {sessions.map((s) => {
        if (s.dormant) return null;
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
            <TerminalView id={s.id} kind={s.kind} visible={!!r} focused={r?.leaf.id === layout.focusedId} />
            <TerminalHelpers sessionId={s.id} kind={s.kind} />
            {s.kind !== 'shell' && config.projects.find((p) => p.id === s.projectId)?.figma && (
              <FigmaChips sessionId={s.id} kind={s.kind} />
            )}
            {s.remote && <ConnectionBanner session={s} />}
            <TerminalSearch sessionId={s.id} />
          </div>
        );
      })}

      {dividers(shown).map((d) => (
        <div
          key={d.path || 'root'}
          className="c-split__divider"
          role="separator"
          aria-orientation={d.dir === 'row' ? 'vertical' : 'horizontal'}
          aria-valuenow={Math.round(d.ratio * 100)}
          title={t('action.resizePane')}
          data-dir={d.dir}
          data-active={drag?.path === d.path || undefined}
          style={dividerStyle(d)}
          onPointerDown={(e) => startResize(e, d)}
          onDoubleClick={() => onResize(d.path, 0.5)}
        />
      ))}

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
