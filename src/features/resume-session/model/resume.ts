import { api, type HistoryEntry, type HistoryResumeResult } from '@/shared/api';

/**
 * Resume a past session by id in a new tab: `claude --resume <id>` with the account whose config dir holds it, or
 * `codex resume <id>`, in the folder it ran in. A folder that isn't a project yet is added as one first (on an SSH
 * host: as a remote project on that host, T36).
 */
export function resumeSession(entry: HistoryEntry): Promise<HistoryResumeResult> {
  return api.historyResume({ agent: entry.agent, id: entry.id, host: entry.host }, !entry.projectId);
}
