import { useState } from 'react';
import { Button } from '@design-system/react';
import type { HistoryEntry, HistoryResumeResult } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { resumeSession } from '../model/resume';

interface Props {
  entry: HistoryEntry;
  onResumed: (result: HistoryResumeResult) => void;
  onError: (message: string) => void;
}

/** "Resume" — or "Add project and resume" when the session's folder isn't a project yet. */
export default function ResumeButton({ entry, onResumed, onError }: Props) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="primary"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        resumeSession(entry)
          .then(onResumed)
          .catch((e: Error) => onError(e.message))
          .finally(() => setBusy(false));
      }}
    >
      {entry.projectId ? t('history.resume') : t('history.resumeAdd')}
    </Button>
  );
}
