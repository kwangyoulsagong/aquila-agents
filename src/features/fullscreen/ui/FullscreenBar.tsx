import { Button, TitleBar } from '@design-system/react';
import type { Config, Session } from '@/shared/api';
import { sessionTitle, useT } from '@/shared/i18n';
import { withShortcut } from '@/shared/lib/shortcuts';
import { StatusDot } from '@/entities/session';

interface Props {
  config: Config;
  /** The focused pane's session (none = empty pane). */
  session: Session | undefined;
  onExit: () => void;
}

/**
 * The only chrome left in full window: the traffic lights' band, with what's on screen and the way back.
 * Keeps the window draggable and the terminal clear of the traffic lights.
 */
export function FullscreenBar({ config, session: s, onExit }: Props) {
  const t = useT();
  const project = s && config.projects.find((p) => p.id === s.projectId);
  return (
    <TitleBar
      lead={s && <StatusDot status={s.status} estimated={s.estimated} reason={s.reason} />}
      actions={
        <Button variant="ghost" onClick={onExit} title={withShortcut(t('fullscreen.exit'), 'fullscreen')}>
          {t('fullscreen.exit')}
        </Button>
      }
    >
      {s
        ? `${sessionTitle(t, s)} · ${project?.name ?? s.projectId}${s.worktree && s.worktree.branch !== sessionTitle(t, s) ? ` · ${s.worktree.branch}` : ''}`
        : t('pane.empty')}
    </TitleBar>
  );
}

/** Tab-bar button that enters full window. */
export function FullscreenButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <Button
      variant="ghost"
      icon
      onClick={onClick}
      title={withShortcut(t('fullscreen.enter'), 'fullscreen')}
      aria-label={t('fullscreen.enter')}
    >
      ⛶
    </Button>
  );
}
