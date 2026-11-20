import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Button, ChangeRow, Dialog, Segment } from '@design-system/react';
import {
  api,
  type GitAction,
  type GitFileChange,
  type GitScope,
  type Project,
  type Session,
} from '@/shared/api';
import { useT } from '@/shared/i18n';
import { DiffView, hunkPatch, parseDiff, type DiffFile, type DiffMode } from '@/entities/diff';
import { pasteIntoSession } from '@/entities/session';
import { useChanges } from '../model/useChanges';
import {
  anchorOf,
  buildReviewPrompt,
  sameAnchor,
  type LineAnchor,
  type LineComment,
} from '../model/comments';
import { CommentEditor, CommentNote } from './CommentBox';

interface Props {
  project: Project | undefined;
  /** Focused session: when it belongs to this project the panel follows its worktree, can diff since its start, and
   * prompts are pasted into it. */
  session?: Session;
  onClose: () => void;
}

interface Confirm {
  title: string;
  body: string;
  run: () => void;
}

const MODE_KEY = 'aquila.changes.mode';
const readMode = (): DiffMode => {
  try {
    return localStorage.getItem(MODE_KEY) === 'split' ? 'split' : 'unified';
  } catch {
    return 'unified';
  }
};

/** "updated n s ago", ticking once a second. */
function Updated({ at }: { at: number | undefined }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!at) return null;
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 2) return <>{t('changes.updated.now')}</>;
  if (s < 60) return <>{t('changes.updated.sec', { n: String(s) })}</>;
  return <>{t('changes.updated.min', { n: String(Math.floor(s / 60)) })}</>;
}

/** Hunks can be staged/reverted only on a plain modified file with nothing staged yet (the hunk is against HEAD). */
const hunkActionable = (f: DiffFile, st: GitFileChange | undefined) =>
  !!st && st.index === ' ' && st.worktree === 'M' && !f.isNew && !f.isDeleted && !f.binary && !f.oldPath;

/**
 * Right panel (⌘⇧G): branch, changed files and the diff of the selected project — updated as files change.
 * Review loop (T25): comment on lines and paste them into the focused session as one prompt, stage or revert
 * files and hunks (reverts are confirmed and backed up), diff since the session started.
 */
export default function ChangesPanel({ project, session, onClose }: Props) {
  const t = useT();
  const own = session && session.projectId === project?.id ? session : undefined;
  const [scope, setScope] = useState<GitScope>('worktree');
  const activeScope: GitScope = own ? scope : 'worktree';
  const remote = project?.remote;
  const { changes, error, refresh } = useChanges(project?.id ?? null, own?.id, activeScope, !!remote);
  const files = useMemo(() => parseDiff(changes?.diff ?? ''), [changes?.diff]);
  const statusOf = useMemo(() => new Map((changes?.files ?? []).map((f) => [f.path, f])), [changes?.files]);
  const [mode, setModeState] = useState<DiffMode>(readMode);
  const [current, setCurrent] = useState<string>();
  const [comments, setComments] = useState<LineComment[]>([]);
  const [draft, setDraft] = useState<LineAnchor | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const body = useRef<HTMLDivElement>(null);

  // Another project: comments and drafts belong to the old diff.
  useEffect(() => {
    setComments([]);
    setDraft(null);
    setCurrent(undefined);
    setNotice(null);
  }, [project?.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const setMode = (m: DiffMode) => {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      /* per-viewer convenience only */
    }
  };

  const scrollTo = (path: string) => {
    setCurrent(path);
    const el = body.current?.querySelector(`[data-path="${CSS.escape(path)}"]`);
    el?.scrollIntoView({ block: 'start' });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== 'j' && e.key !== 'k')) return;
    if (!files.length) return;
    e.preventDefault();
    const i = files.findIndex((f) => f.path === current);
    const next = e.key === 'j' ? Math.min(files.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
    scrollTo(files[next].path);
  };

  const paste = (text: string) => {
    if (!own || own.exited || !pasteIntoSession(own.id, text)) {
      setNotice(t('changes.noSession'));
      return false;
    }
    return true;
  };

  const sendComments = () => {
    const prompt = buildReviewPrompt(comments, {
      intro: t('changes.prompt.review'),
      removed: t('changes.prompt.removed'),
    });
    if (paste(prompt)) setComments([]);
  };

  const run = (a: Omit<GitAction, 'projectId' | 'sessionId'>) => {
    if (!project) return;
    api
      .gitAction({ ...a, projectId: project.id, sessionId: own?.id })
      .then((r) => {
        if (r.stash) setNotice(t('changes.backup.stash', { sha: r.stash.slice(0, 7) }));
        else if (r.trashedTo) setNotice(t('changes.backup.remoteTrash', { path: r.trashedTo }));
        else if (r.trashed) setNotice(t('changes.backup.trash'));
      })
      .catch((e: Error) => setNotice(e.message))
      .finally(refresh);
  };

  const askRevert = (title: string, untracked: boolean, a: Omit<GitAction, 'projectId' | 'sessionId'>) =>
    setConfirm({
      title,
      body: t(
        !untracked
          ? 'changes.revert.body'
          : remote
            ? 'changes.revert.bodyUntrackedRemote'
            : 'changes.revert.bodyUntracked',
      ),
      run: () => run(a),
    });

  const editable = activeScope === 'worktree';

  const fileActions = (f: DiffFile) => {
    const st = statusOf.get(f.path);
    if (!editable || !st || st.status === 'U') return null;
    const target = { path: f.path, origPath: st.origPath };
    return (
      <>
        {st.worktree !== ' ' && (
          <Button variant="ghost" onClick={() => run({ action: 'stage-file', ...target })}>
            {t('changes.stage')}
          </Button>
        )}
        {st.index !== ' ' && st.index !== '?' && (
          <Button variant="ghost" onClick={() => run({ action: 'unstage-file', ...target })}>
            {t('changes.unstage')}
          </Button>
        )}
        <Button
          variant="ghost"
          onClick={() =>
            askRevert(t('changes.revertFile.title', { path: f.path }), st.status === '?', {
              action: 'revert-file',
              ...target,
            })
          }
        >
          {t('changes.revert')}
        </Button>
      </>
    );
  };

  const hunkActions = (f: DiffFile, hunk: number) => {
    if (!editable || !hunkActionable(f, statusOf.get(f.path))) return null;
    const patch = hunkPatch(f, hunk);
    return (
      <>
        <Button variant="ghost" onClick={() => run({ action: 'stage-hunk', path: f.path, patch })}>
          {t('changes.stage')}
        </Button>
        <Button
          variant="ghost"
          onClick={() =>
            askRevert(t('changes.revertHunk.title'), false, { action: 'revert-hunk', path: f.path, patch })
          }
        >
          {t('changes.revert')}
        </Button>
      </>
    );
  };

  const renderAfter = (f: DiffFile, index: number) => {
    const anchor = anchorOf(f, f.lines[index]);
    if (!anchor) return null;
    const notes = comments.filter((c) => sameAnchor(c, anchor));
    const editing = draft && sameAnchor(draft, anchor);
    if (!notes.length && !editing) return null;
    return (
      <>
        {notes.map((c, i) => (
          <CommentNote
            key={i}
            text={c.text}
            onRemove={() => setComments((all) => all.filter((x) => x !== c))}
          />
        ))}
        {editing && (
          <CommentEditor
            onCancel={() => setDraft(null)}
            onAdd={(text) => {
              setComments((all) => [...all, { ...anchor, text }]);
              setDraft(null);
            }}
          />
        )}
      </>
    );
  };

  const branch = changes?.isRepo
    ? [changes.branch, changes.ahead ? `↑${changes.ahead}` : '', changes.behind ? `↓${changes.behind}` : '']
        .filter(Boolean)
        .join(' ')
    : '';
  const tree =
    activeScope === 'session' && changes?.base
      ? t('changes.source.session', { sha: changes.base.slice(0, 7) })
      : t('changes.source.worktree');
  // Remote (T36): which host, and how long the last round trip took.
  const source = remote
    ? `${t('changes.source.remote', { host: remote.alias })} · ${tree}${
        changes?.latencyMs !== undefined
          ? ` · ${t('changes.latency', { ms: String(changes.latencyMs) })}`
          : ''
      }`
    : tree;

  return (
    <aside
      className={mode === 'split' ? 'c-panel c-panel--wide' : 'c-panel'}
      aria-label={t('changes.title')}
      onKeyDown={onKeyDown}
    >
      <div className="c-panel__head">
        <span>{t('changes.title')}</span>
        {branch && (
          <span
            className="c-row__meta"
            title={[branch, own?.worktree?.path ?? project?.path].filter(Boolean).join('\n')}
          >
            {branch}
          </span>
        )}
        {changes?.isRepo && changes.files.length > 0 && (
          <span className="c-row__meta" data-fixed>
            {t('changes.files', { count: String(changes.files.length) })}
          </span>
        )}
        <div className="c-panel__actions">
          <Button
            variant="ghost"
            icon
            onClick={refresh}
            title={t('changes.refresh')}
            aria-label={t('changes.refresh')}
          >
            ↻
          </Button>
          <Button
            variant="ghost"
            icon
            onClick={onClose}
            title={t('action.close')}
            aria-label={t('action.close')}
          >
            ×
          </Button>
        </div>
      </div>
      {changes?.isRepo && (
        <>
          <div className="c-panel__bar">
            <span>
              {source} · <Updated at={changes.checkedAt} />
            </span>
            <div className="c-panel__bar-end">
              {own && (
                <Segment
                  label={t('changes.scope')}
                  value={scope}
                  onChange={setScope}
                  options={[
                    { value: 'worktree', label: t('changes.scope.worktree') },
                    { value: 'session', label: t('changes.scope.session') },
                  ]}
                />
              )}
              <Segment
                label={t('changes.mode')}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'unified', label: t('changes.mode.unified') },
                  { value: 'split', label: t('changes.mode.split') },
                ]}
              />
            </div>
          </div>
          <div className="c-panel__bar">
            <Button
              variant="ghost"
              disabled={!own}
              title={t('changes.ask.title')}
              onClick={() => paste(t('changes.prompt.commit'))}
            >
              {t('changes.ask.commit')}
            </Button>
            <Button
              variant="ghost"
              disabled={!own}
              title={t('changes.ask.title')}
              onClick={() => paste(t('changes.prompt.pr'))}
            >
              {t('changes.ask.pr')}
            </Button>
            <div className="c-panel__bar-end">
              {comments.length > 0 ? (
                <>
                  <Button variant="ghost" onClick={() => setComments([])}>
                    {t('changes.comments.clear')}
                  </Button>
                  <Button variant="primary" title={t('changes.ask.title')} onClick={sendComments}>
                    {t('changes.comments.send', { count: String(comments.length) })}
                  </Button>
                </>
              ) : (
                <span>{t('changes.hint')}</span>
              )}
            </div>
          </div>
        </>
      )}
      {notice && (
        <div className="c-panel__note" role="status">
          {notice}
        </div>
      )}
      <div className="c-panel__body" ref={body} tabIndex={-1}>
        {error && <div className="c-panel__note">{error}</div>}
        {changes && !changes.isRepo && <div className="c-panel__note">{t('changes.notRepo')}</div>}
        {changes?.isRepo && changes.files.length === 0 && (
          <div className="c-panel__note">{t('changes.none')}</div>
        )}
        {changes?.isRepo && changes.files.length > 0 && (
          <>
            <div className="c-panel__section">
              {changes.files.map((f) => (
                <ChangeRow
                  key={f.path}
                  status={f.status}
                  path={f.path}
                  aria-current={current === f.path || undefined}
                  onClick={() => scrollTo(f.path)}
                />
              ))}
            </div>
            <DiffView
              files={files}
              mode={mode}
              current={current}
              onLineClick={(f, i) => {
                const anchor = anchorOf(f, f.lines[i]);
                if (anchor) setDraft(anchor);
                setCurrent(f.path);
              }}
              isCommented={(f, i) => {
                const anchor = anchorOf(f, f.lines[i]);
                return !!anchor && comments.some((c) => sameAnchor(c, anchor));
              }}
              renderAfter={renderAfter}
              renderFileActions={fileActions}
              renderHunkActions={hunkActions}
            />
            {changes.truncated && <div className="c-panel__note">{t('changes.truncated')}</div>}
          </>
        )}
      </div>
      <Dialog
        open={!!confirm}
        title={confirm?.title ?? ''}
        onClose={() => setConfirm(null)}
        actions={
          <>
            <Button onClick={() => setConfirm(null)}>{t('action.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                confirm?.run();
                setConfirm(null);
              }}
            >
              {t('changes.revert')}
            </Button>
          </>
        }
      >
        {confirm?.body}
      </Dialog>
    </aside>
  );
}
