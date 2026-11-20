import type { Config, Project, Session, SessionKind, SessionStatus, Worktree } from '@/shared/api';
import { groupLabel, kindLabel, type Translate } from '@/shared/i18n';
import { shortcutLabel, type ShortcutId } from '@/shared/lib/shortcuts';

/** Actions the palette can run. The workspace passes a handler for each one that applies right now. */
export type ActionId =
  | 'openClaude'
  | 'openCodex'
  | 'openShell'
  | 'openWorktree'
  | 'cleanupWorktrees'
  | 'addProject'
  | 'projectSettings'
  | 'openProjectIn'
  | 'splitRight'
  | 'splitDown'
  | 'zoomPane'
  | 'fullscreen'
  | 'toggleChanges'
  | 'togglePreview'
  | 'history'
  | 'nextWaiting'
  | 'copyLastReply'
  | 'quickSelect'
  | 'find'
  | 'closeSession'
  | 'switchLanguage'
  | 'globalShortcut'
  | 'firstRun'
  | 'guide'
  | 'whatsNew';

export type Command =
  | {
      type: 'session';
      id: string;
      sessionId: string;
      label: string;
      kind: SessionKind;
      status: SessionStatus;
      account?: string;
      current: boolean;
    }
  | {
      type: 'project';
      id: string;
      projectId: string;
      label: string;
      /** Group · path; also searched. */
      hint: string;
      status: SessionStatus;
      current: boolean;
    }
  | {
      type: 'worktree';
      id: string;
      branch: string;
      kind: SessionKind;
      label: string;
      /** "Worktree · <path>"; also searched. */
      hint: string;
    }
  | { type: 'action'; id: string; action: ActionId; label: string; kbd?: string };

/** Label and shortcut per action, in the order they're listed. */
const ACTIONS: {
  action: ActionId;
  /** `project`: the current one (actions on it are only listed when there is one). */
  label: (t: Translate, project?: Project) => string;
  shortcut?: ShortcutId;
}[] = [
  { action: 'openClaude', label: (t) => t('action.openClaude'), shortcut: 'openClaude' },
  { action: 'openCodex', label: (t) => t('action.openCodex'), shortcut: 'openCodex' },
  { action: 'openShell', label: (t) => t('palette.openShell'), shortcut: 'openShell' },
  { action: 'openWorktree', label: (t) => t('worktree.title') },
  { action: 'cleanupWorktrees', label: (t) => t('worktree.cleanupTitle') },
  { action: 'projectSettings', label: (t) => t('settings.action') },
  { action: 'openProjectIn', label: (t, p) => t('settings.openInAction', { app: p?.openIn || 'Finder' }) },
  { action: 'addProject', label: (t) => t('projects.add') },
  { action: 'splitRight', label: (t) => t('palette.splitRight'), shortcut: 'splitRight' },
  { action: 'splitDown', label: (t) => t('palette.splitDown'), shortcut: 'splitDown' },
  { action: 'zoomPane', label: (t) => t('action.zoomPane'), shortcut: 'zoomPane' },
  { action: 'fullscreen', label: (t) => t('fullscreen.toggle'), shortcut: 'fullscreen' },
  { action: 'toggleChanges', label: (t) => t('changes.toggle'), shortcut: 'toggleChanges' },
  { action: 'togglePreview', label: (t) => t('preview.toggle'), shortcut: 'togglePreview' },
  { action: 'history', label: (t) => t('history.title'), shortcut: 'history' },
  { action: 'nextWaiting', label: (t) => t('attention.next'), shortcut: 'nextWaiting' },
  { action: 'copyLastReply', label: (t) => t('term.copyLastReply'), shortcut: 'copyLastReply' },
  { action: 'quickSelect', label: (t) => t('term.quickSelect'), shortcut: 'quickSelect' },
  { action: 'find', label: (t) => t('term.find'), shortcut: 'find' },
  { action: 'closeSession', label: (t) => t('action.closeSession'), shortcut: 'closeSession' },
  { action: 'switchLanguage', label: (t) => t('palette.switchLanguage') },
  { action: 'globalShortcut', label: (t) => t('globalShortcut.menu') },
  { action: 'firstRun', label: (t) => t('firstRun.checklist') },
  { action: 'guide', label: (t) => t('guide.title'), shortcut: 'guide' },
  { action: 'whatsNew', label: (t) => t('notes.title') },
];

/** Sessions that need you come first in the list. */
const URGENCY: Record<SessionStatus, number> = {
  waiting: 0,
  error: 1,
  done: 2,
  working: 3,
  stopped: 4,
  idle: 5,
};

function projectStatus(sessions: Session[]): SessionStatus {
  return sessions.reduce<SessionStatus>(
    (worst, s) => (URGENCY[s.status] < URGENCY[worst] ? s.status : worst),
    'idle',
  );
}

interface Input {
  config: Config;
  sessions: Session[];
  activeProjectId: string | null;
  activeSessionId: string | null;
  /** Actions that apply right now (others aren't listed). */
  available: ReadonlySet<ActionId>;
  /** Linked worktrees of the current project: Claude / Codex / Shell in each, listed after the actions. */
  worktrees?: Worktree[];
  t: Translate;
}

/**
 * Everything the palette lists, in its order for an empty query: open sessions (most urgent first),
 * projects (sidebar order), then actions.
 */
export function buildCommands({
  config,
  sessions,
  activeProjectId,
  activeSessionId,
  available,
  worktrees = [],
  t,
}: Input): Command[] {
  const projectName = new Map(config.projects.map((p) => [p.id, p.name]));
  const activeProject = config.projects.find((p) => p.id === activeProjectId);

  // "Claude · SALT", "Claude 2 · SALT" when a project has more than one of a kind.
  const seen = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const s of sessions)
    counts.set(`${s.projectId}/${s.kind}`, (counts.get(`${s.projectId}/${s.kind}`) ?? 0) + 1);
  const sessionCommands: Command[] = sessions
    .filter((s) => projectName.has(s.projectId))
    .map((s) => {
      const key = `${s.projectId}/${s.kind}`;
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      const kind = (counts.get(key) ?? 0) > 1 ? `${kindLabel(t, s.kind)} ${n}` : kindLabel(t, s.kind);
      return {
        type: 'session' as const,
        id: `session:${s.id}`,
        sessionId: s.id,
        label: [kind, projectName.get(s.projectId), s.worktree?.branch].filter(Boolean).join(' · '),
        kind: s.kind,
        status: s.status,
        account: s.account,
        current: s.id === activeSessionId,
      };
    })
    .map((c, order) => ({ c, order }))
    .sort((a, b) => URGENCY[a.c.status] - URGENCY[b.c.status] || a.order - b.order)
    .map(({ c }) => c);

  const groupName = new Map(config.groups.map((g) => [g.id, groupLabel(t, g)]));
  const projectCommands: Command[] = config.projects.map((p) => ({
    type: 'project',
    id: `project:${p.id}`,
    projectId: p.id,
    label: p.name,
    hint: [groupName.get(p.group) ?? p.group, p.path].join(' · '),
    status: projectStatus(sessions.filter((s) => s.projectId === p.id)),
    current: p.id === activeProjectId,
  }));

  const actionCommands: Command[] = ACTIONS.filter((a) => available.has(a.action)).map((a) => ({
    type: 'action',
    id: `action:${a.action}`,
    action: a.action,
    label: a.label(t, activeProject),
    kbd: a.shortcut && shortcutLabel(a.shortcut),
  }));

  const kinds: SessionKind[] = ['claude', 'codex', 'shell'];
  const worktreeCommands: Command[] = worktrees.flatMap((w) =>
    kinds.map((kind) => ({
      type: 'worktree' as const,
      id: `worktree:${kind}:${w.path}`,
      branch: w.branch,
      kind,
      label: `${kindLabel(t, kind)} · ${w.branch}`,
      hint: t('worktree.paletteHint', { path: w.path }),
    })),
  );

  return [...sessionCommands, ...projectCommands, ...actionCommands, ...worktreeCommands];
}

/** Extra text a command is also found by (weaker than its label). */
export function commandDetail(c: Command): string {
  return c.type === 'project' || c.type === 'worktree' ? c.hint : '';
}
