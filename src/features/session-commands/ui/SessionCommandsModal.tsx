import { useEffect, useState } from 'react';
import { Modal, ModalNote } from '@design-system/react';
import { api, type CommandRun, type Session } from '@/shared/api';
import { sessionTitle, useT } from '@/shared/i18n';
import { CommandTimeline } from '@/entities/command';

/**
 * ⌘K "Commands in this session" (T59): the focused Claude tab's Bash commands, read fresh from its transcript each
 * time the modal opens. Read-only; output is never read.
 */
export default function SessionCommandsModal({ session, onClose }: { session: Session; onClose: () => void }) {
  const t = useT();
  const [commands, setCommands] = useState<CommandRun[] | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    api
      .sessionCommands(session.id)
      .then((c) => live && setCommands(c))
      .catch(() => live && setCommands(null));
    return () => {
      live = false;
    };
  }, [session.id]);

  return (
    <Modal
      open
      title={t('commands.action')}
      subtitle={sessionTitle(t, session)}
      onClose={onClose}
      closeLabel={t('action.close')}
      footer={t('commands.note')}
    >
      {commands === null && <ModalNote>{t('commands.unavailable')}</ModalNote>}
      {commands && commands.length === 0 && <ModalNote>{t('commands.none')}</ModalNote>}
      {commands && commands.length > 0 && <CommandTimeline commands={commands} />}
    </Modal>
  );
}
