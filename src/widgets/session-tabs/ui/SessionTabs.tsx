import type { ReactNode } from 'react';
import type { Config, Session, SessionKind } from '@/shared/api';
import { kindLabel, useT } from '@/shared/i18n';
import { endSessionDrag, startSessionDrag } from '@/shared/lib/sessionDrag';
import { AccountBadge } from '@/entities/project';
import { StatusDot } from '@/entities/session';

interface Props {
  config: Config;
  sessions: Session[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: (kind: SessionKind) => void;
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
  trailing,
}: Props) {
  const t = useT();
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
          <StatusDot status={s.status} />
          <span className="c-tab__title">{kindLabel(t, s.kind)}</span>
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
      <button
        className="c-btn c-btn--ghost c-btn--icon c-tabbar__add"
        title={`${t('action.openClaude')} (⌘T)`}
        onClick={() => onNew('claude')}
      >
        +
      </button>
      {trailing && <div className="c-tabbar__trailing">{trailing}</div>}
    </div>
  );
}
