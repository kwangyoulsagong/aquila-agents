import { Button } from '@design-system/react';
import { api } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { handlePrompt } from '../model/handle';

export interface HandleWithClaudeProps {
  notePath: string;
  /** A to-do taken from the note: the prompt names it. */
  todo?: string;
  /** Opens a Claude tab in that project (the page's) with the prompt pasted, not sent. */
  onClaude: (prompt: string, projectId: string | undefined) => void;
}

/**
 * "Handle with Claude" (T70): a Claude tab in the project the note is in, with the note as `@path`. The session then
 * shows in the graph as note → session → the files it changed.
 */
export function HandleWithClaude({ notePath, todo, onClaude }: HandleWithClaudeProps) {
  const t = useT();
  const run = async () => {
    const intro = todo ? t('note.handle.todo', { todo }) : t('note.handle.note');
    const projectId = await api.noteProject(notePath).catch(() => null);
    onClaude(handlePrompt(intro, notePath), projectId ?? undefined);
  };
  return (
    <Button variant="ghost" onClick={() => void run()} title={t('note.handle.hint')}>
      {t('note.handle')}
    </Button>
  );
}
