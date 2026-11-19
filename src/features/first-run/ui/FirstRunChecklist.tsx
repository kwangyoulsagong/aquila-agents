import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Badge,
  Button,
  Checklist,
  ChecklistCommand,
  ChecklistItem,
  Dialog,
  Dot,
  Dropzone,
} from '@design-system/react';
import { api, type Config, type ToolCheck } from '@/shared/api';
import { useT } from '@/shared/i18n';
import type { FirstRun } from '../model/useFirstRun';

interface Props {
  firstRun: FirstRun;
  config: Config;
  onConfigChanged: (config: Config) => void;
  /** Select a project the checklist just added. */
  onSelectProject: (projectId: string) => void;
  onError: (message: string) => void;
}

/**
 * First-run checklist: shell PATH, `claude` / `codex` / `git` with versions (install command to copy, or pick the
 * binary), add project folders (drop or folder picker), and where to log in. Never blocks: closing = skip.
 */
export default function FirstRunChecklist({
  firstRun,
  config,
  onConfigChanged,
  onSelectProject,
  onError,
}: Props) {
  const t = useT();
  const { report, checking, recheck, close, pickBinary, resetBinary } = firstRun;
  const [added, setAdded] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const startRef = useRef<HTMLButtonElement>(null);
  const configRef = useRef(config);
  configRef.current = config;

  // showModal() (the Dialog's effect, which runs first) focuses the first button — a "Choose…" — so Enter would open
  // a file picker. Start on the primary button instead.
  useEffect(() => startRef.current?.focus(), []);

  // Re-check when the user comes back from installing something in a terminal.
  useEffect(() => {
    const onFocus = () => void recheck();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [recheck]);

  // A folder dropped beside the drop zone (or on the backdrop) must not navigate the window to it.
  useEffect(() => {
    const stop = (e: globalThis.DragEvent) => e.preventDefault();
    document.addEventListener('dragover', stop);
    document.addEventListener('drop', stop);
    return () => {
      document.removeEventListener('dragover', stop);
      document.removeEventListener('drop', stop);
    };
  }, []);

  const addFolders = async (paths: string[]) => {
    let next = configRef.current;
    const newProjects: { id: string; name: string }[] = [];
    for (const path of paths) {
      const before = new Set(next.projects.map((p) => p.id));
      try {
        next = await api.editProjects({
          op: 'addProject',
          path,
          name: '',
          group: next.groups[0]?.id ?? 'work',
          account: next.accounts.shared ? 'shared' : (Object.keys(next.accounts)[0] ?? 'shared'),
        });
      } catch (e) {
        onError((e as Error).message);
        break;
      }
      const project = next.projects.find((p) => !before.has(p.id));
      if (project) newProjects.push(project);
      configRef.current = next;
    }
    onConfigChanged(next);
    const last = newProjects[newProjects.length - 1];
    if (last) onSelectProject(last.id);
    if (newProjects.length) setAdded((a) => [...a, ...newProjects.map((p) => p.name)]);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const paths = [...e.dataTransfer.items]
      .filter((item) => item.kind === 'file' && item.webkitGetAsEntry()?.isDirectory)
      .map((item) => item.getAsFile())
      .filter((f): f is File => f !== null)
      .map((f) => api.pathForFile(f))
      .filter(Boolean);
    if (paths.length) void addFolders(paths);
  };

  const pick = async () => {
    const path = await api.pickFolder();
    if (path) void addFolders([path]);
  };

  const claudeFound = report?.tools.find((x) => x.tool === 'claude')?.found ?? false;

  return (
    <Dialog
      open
      wide
      title={t('firstRun.title')}
      onClose={close}
      actions={
        <>
          <Button variant="ghost" onClick={() => void recheck()} disabled={checking}>
            {t('firstRun.recheck')}
          </Button>
          <Button ref={startRef} variant="primary" onClick={close}>
            {claudeFound ? t('firstRun.done') : t('firstRun.skip')}
          </Button>
        </>
      }
    >
      <p>{t('firstRun.intro')}</p>
      <Checklist label={t('firstRun.checklist')}>
        {report && (
          <ChecklistItem
            leading={<Dot status={report.pathRestored ? 'done' : 'waiting'} />}
            title={t(report.pathRestored ? 'firstRun.pathOk' : 'firstRun.pathFailed')}
            meta={report.pathRestored ? undefined : t('firstRun.pathFailedHint')}
          />
        )}
        {report?.tools.map((check) => (
          <ToolRow
            key={check.tool}
            check={check}
            onPick={() => pickBinary(check.tool).catch((e: unknown) => onError((e as Error).message))}
            onReset={() => resetBinary(check.tool).catch((e: unknown) => onError((e as Error).message))}
          />
        ))}
        <ChecklistItem
          leading={<Dot status={config.projects.length ? 'done' : 'waiting'} />}
          title={t('firstRun.projects')}
          meta={
            added.length
              ? t('firstRun.added', { names: added.join(', ') })
              : config.projects.length
                ? t('firstRun.projectsCount', { count: String(config.projects.length) })
                : t('firstRun.projectsNone')
          }
        >
          <Dropzone
            over={over}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            {t('firstRun.drop')}
            <Button onClick={() => void pick()}>{t('firstRun.addFolder')}</Button>
          </Dropzone>
        </ChecklistItem>
        <ChecklistItem
          leading={<Dot status="idle" />}
          title={t('firstRun.login')}
          meta={t('firstRun.loginHint')}
        />
      </Checklist>
      <p>{t('firstRun.reopenHint')}</p>
    </Dialog>
  );
}

function ToolRow({ check, onPick, onReset }: { check: ToolCheck; onPick: () => void; onReset: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const optional = check.tool === 'codex';
  const status = check.found ? 'done' : optional ? 'idle' : 'waiting';
  const found = [check.version, check.path].filter(Boolean).join(' · ');
  const meta = check.found
    ? `${found}${check.override ? ` (${t('firstRun.picked')})` : ''}`
    : check.path
      ? t('firstRun.didntRun', { path: check.path })
      : check.tool === 'git'
        ? `${t('firstRun.notFound')} · ${t('firstRun.gitWhy')}`
        : t('firstRun.notFound');

  const copy = () => {
    api.copyText(check.install);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ChecklistItem
      leading={<Dot status={status} />}
      title={t(`firstRun.tool.${check.tool}`)}
      tag={optional && <Badge>{t('firstRun.optional')}</Badge>}
      meta={meta}
      actions={
        <>
          {check.override && (
            <Button variant="ghost" onClick={onReset}>
              {t('firstRun.usePath')}
            </Button>
          )}
          <Button variant="ghost" onClick={onPick}>
            {t('firstRun.choose')}
          </Button>
        </>
      }
    >
      {check.rejected && <p role="alert">{t('firstRun.rejected', { path: check.rejected })}</p>}
      {!check.found && (
        <>
          <p>{t('firstRun.install')}</p>
          <ChecklistCommand
            command={check.install}
            action={
              <Button variant="ghost" onClick={copy} aria-live="polite">
                {copied ? t('firstRun.copied') : t('firstRun.copy')}
              </Button>
            }
          />
        </>
      )}
    </ChecklistItem>
  );
}
