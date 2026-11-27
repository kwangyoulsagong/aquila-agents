import { api, type GraphNode, type HistoryResumeResult, type Session } from '@/shared/api';

/** `session:<agent>:<id>` → the history ref it was made from. */
export function sessionRef(n: Pick<GraphNode, 'id'>): { agent: 'claude' | 'codex'; id: string } | null {
  const m = /^session:(claude|codex):(.+)$/.exec(n.id);
  return m ? { agent: m[1] as 'claude' | 'codex', id: m[2]! } : null;
}

/** The open tab running a graph session node's conversation, if any (ask main which tab has which conversation). */
export async function liveTabOf(
  n: Pick<GraphNode, 'id'>,
  sessions: readonly Session[],
): Promise<string | null> {
  const ref = sessionRef(n);
  if (!ref) return null;
  const open = new Set(
    sessions.filter((s) => s.kind !== 'shell' && !s.remote && !s.dormant).map((s) => s.id),
  );
  const ids = await api.sessionAgentIds().catch(() => []);
  return ids.find((x) => x.agent === ref.agent && x.sessionId === ref.id && open.has(x.tabId))?.tabId ?? null;
}

/**
 * A graph session node, clicked outside the graph (the editor's "Referenced in", T79): its tab comes to the front
 * when it's open, otherwise the conversation is resumed in a new tab — what the graph does.
 */
export async function openSessionNode(
  n: Pick<GraphNode, 'id' | 'projects'>,
  opts: {
    sessions: readonly Session[];
    onShow: (tabId: string) => void;
    onResumed: (r: HistoryResumeResult) => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const ref = sessionRef(n);
  if (!ref) return;
  const tab = await liveTabOf(n, opts.sessions);
  if (tab) return opts.onShow(tab);
  try {
    opts.onResumed(await api.historyResume(ref, !n.projects?.length));
  } catch (e) {
    opts.onError(e instanceof Error ? e.message : String(e));
  }
}
