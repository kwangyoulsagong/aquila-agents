import { useEffect, useId, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  Badge,
  Button,
  Input,
  MetaList,
  MetaRow,
  Modal,
  ModalActions,
  ModalDetail,
  ModalEmpty,
  ModalGroup,
  ModalItem,
  ModalList,
  ModalNote,
  ModalSearch,
  ModalTools,
  Segment,
  Transcript,
  TranscriptMessage,
} from '@design-system/react';
import { api, type Config, type HistoryEntry, type HistoryResumeResult } from '@/shared/api';
import { accountLabel, kindLabel, useT } from '@/shared/i18n';
import { CommandTimeline } from '@/entities/command';
import { useNow } from '@/shared/lib/useNow';
import { ResumeButton, resumeSession } from '@/features/resume-session';
import {
  daysLeft,
  filterHistory,
  groupHistory,
  historyTitle,
  matchesListed,
  parseRefKey,
  refKey,
  relativeTime,
  type HistoryFilter,
} from '../model/history';
import { useHistory } from '../model/useHistory';

interface Props {
  open: boolean;
  onClose: () => void;
  config: Config;
  /** A past session was resumed in a new tab (its folder may have been added as a project). */
  onResumed: (result: HistoryResumeResult) => void;
  onError: (message: string) => void;
}

const NO_ENTRIES: HistoryEntry[] = [];

/** Preview shows this many messages; the rest is in the Markdown export. */
const PREVIEW_MESSAGES = 60;

/**
 * ⌘Y: every past Claude / Codex session, grouped by the folder it ran in. Search covers names, first messages and
 * the conversation text. Resume by id in a new tab, name, favorite, copy the id, export as Markdown. Read-only
 * towards the CLIs: names and favorites are ours (~/.aquila). Remote projects' SSH hosts are scanned too (T36),
 * after the local list is shown.
 */
export default function HistoryPanel({ open, onClose, config, onResumed, onError }: Props) {
  const t = useT();
  const baseId = useId();
  const listId = `${baseId}-list`;
  const locale = config.language === 'ko' ? 'ko-KR' : 'en-US';
  const now = useNow(60_000, open);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setFilter('all');
      setSelectedKey(null);
    }
  }, [open]);

  const selectedRef = useMemo(() => (selectedKey ? parseRefKey(selectedKey) : null), [selectedKey]);
  const hasRemote = config.projects.some((p) => p.remote);
  const history = useHistory(open, query, selectedRef, hasRemote);
  const all = history.list?.entries ?? NO_ENTRIES;
  const results = useMemo(
    () => filterHistory(all, query, filter, history.matches),
    [all, query, filter, history.matches],
  );
  const groups = useMemo(() => groupHistory(results, config), [results, config]);
  // List order = group order, so ↑↓ follow what's on screen.
  const ordered = useMemo(() => groups.flatMap((g) => g.entries), [groups]);
  const selected = ordered.find((e) => refKey(e) === selectedKey) ?? ordered[0];
  const key = selected && refKey(selected);
  // Keep the shown selection and the one the transcript loads for in step.
  useEffect(() => {
    if (key && key !== selectedKey) setSelectedKey(key);
  }, [key, selectedKey]);

  const optionId = (k: string) => `${baseId}-${k.replace(/[^a-zA-Z0-9-]/g, '-')}`;
  const resumed = (r: HistoryResumeResult) => {
    onResumed(r);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || !ordered.length) return; // Korean IME: keys belong to the composition.
    if (e.key === 'Enter' && selected) {
      e.preventDefault();
      resumeSession(selected)
        .then(resumed)
        .catch((err: Error) => onError(err.message));
      return;
    }
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p');
    if (!down && !up) return;
    e.preventDefault();
    const i = selected ? ordered.indexOf(selected) : -1;
    const n = ordered.length;
    setSelectedKey(refKey(ordered[(i + (down ? 1 : n - 1)) % n]));
  };

  const setMeta = (entry: HistoryEntry, change: { name?: string | null; favorite?: boolean }) =>
    api
      .historySetMeta({ agent: entry.agent, id: entry.id, host: entry.host }, change)
      .then((e) => e && history.update(e))
      .catch((err: Error) => onError(err.message));

  const filters = [
    { value: 'all' as const, label: t('history.filter.all') },
    { value: 'favorites' as const, label: t('history.filter.favorites') },
    { value: 'claude' as const, label: kindLabel(t, 'claude') },
    { value: 'codex' as const, label: kindLabel(t, 'codex') },
  ];
  const cleanup = history.list
    ? Math.min(...Object.values(history.list.cleanupDays).filter((d) => d > 0), Infinity)
    : Infinity;

  return (
    <Modal
      open={open}
      wide
      onClose={onClose}
      title={t('history.title')}
      closeLabel={t('action.close')}
      footer={
        <>
          <span>{t('palette.move')}</span>
          <span>{t('history.footer.resume')}</span>
          <span>{t('palette.close')}</span>
          {Number.isFinite(cleanup) && <span>{t('history.cleanup', { n: String(cleanup) })}</span>}
          {history.remoteLoading && <span>{t('history.hosts.checking')}</span>}
          {!history.remoteLoading &&
            history.list?.hosts?.map((h) =>
              h.error ? (
                <span key={h.alias} title={h.error}>
                  {t('history.host.error', { host: h.alias })}
                </span>
              ) : (
                <span key={h.alias}>
                  {t('history.host.ok', { host: h.alias, ms: String(h.latencyMs ?? 0) })}
                </span>
              ),
            )}
        </>
      }
      aside={
        <>
          <ModalSearch
            value={query}
            placeholder={t('history.search')}
            aria-label={t('history.search')}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={key && optionId(key)}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <ModalTools>
            <Segment label={t('history.filter')} options={filters} value={filter} onChange={setFilter} />
          </ModalTools>
          <ModalList id={listId} label={t('history.list')}>
            {history.loading && !history.list && <ModalEmpty>{t('history.loading')}</ModalEmpty>}
            {history.error && <ModalEmpty>{history.error}</ModalEmpty>}
            {history.list && !ordered.length && (
              <ModalEmpty>{all.length ? t('palette.empty') : t('history.empty')}</ModalEmpty>
            )}
            {groups.map((g) => (
              <ModalGroup key={g.key} label={g.label} hint={g.host ? `${g.host}:${g.cwd}` : g.cwd}>
                {g.entries.map((e) => (
                  <ModalItem
                    key={refKey(e)}
                    id={optionId(refKey(e))}
                    selected={e === selected}
                    label={historyTitle(e)}
                    meta={`${e.favorite ? '★ ' : ''}${relativeTime(e.updatedAt, now, t, locale)}`}
                    onSelect={() => setSelectedKey(refKey(e))}
                  />
                ))}
              </ModalGroup>
            ))}
          </ModalList>
        </>
      }
    >
      {selected && (
        <Detail
          key={key}
          entry={selected}
          config={config}
          now={now}
          locale={locale}
          // Only when the hit is in the conversation: otherwise the title / first message already shows it.
          snippet={
            key && query.trim() && !matchesListed(selected, query.trim().toLowerCase())
              ? history.matches.get(key)
              : undefined
          }
          transcript={history.transcript}
          setMeta={setMeta}
          onResumed={resumed}
          onError={onError}
        />
      )}
    </Modal>
  );
}

interface DetailProps {
  entry: HistoryEntry;
  config: Config;
  now: number;
  locale: string;
  snippet?: string;
  transcript: ReturnType<typeof useHistory>['transcript'];
  setMeta: (entry: HistoryEntry, change: { name?: string | null; favorite?: boolean }) => Promise<unknown>;
  onResumed: (r: HistoryResumeResult) => void;
  onError: (message: string) => void;
}

function Detail({
  entry,
  config,
  now,
  locale,
  snippet,
  transcript,
  setMeta,
  onResumed,
  onError,
}: DetailProps) {
  const t = useT();
  const [draft, setDraft] = useState(entry.name ?? '');
  const [renaming, setRenaming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const title = historyTitle(entry);
  const left = daysLeft(entry, now);
  const project = entry.projectId && config.projects.find((p) => p.id === entry.projectId);
  const date = (ms: number) =>
    new Date(ms).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  const agentName = kindLabel(t, entry.agent);

  const submitName = (e: FormEvent) => {
    e.preventDefault();
    void setMeta(entry, { name: draft }).then(() => setRenaming(false));
  };

  return (
    <>
      {renaming ? (
        <ModalActions onSubmit={submitName}>
          <Input
            autoFocus
            value={draft}
            placeholder={entry.title || entry.autoTitle || entry.firstMessage}
            aria-label={t('history.rename')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                e.preventDefault();
                setRenaming(false);
              }
            }}
          />
          <Button type="submit" variant="primary">
            {t('action.save')}
          </Button>
          <Button onClick={() => setRenaming(false)}>{t('action.cancel')}</Button>
        </ModalActions>
      ) : (
        <ModalDetail heading={title} />
      )}
      {renaming && <ModalNote>{t('history.renameHint')}</ModalNote>}
      <ModalActions>
        <ResumeButton entry={entry} onResumed={onResumed} onError={onError} />
        <Button
          onClick={() => void setMeta(entry, { favorite: !entry.favorite })}
          aria-pressed={entry.favorite}
        >
          {entry.favorite ? `★ ${t('history.unfavorite')}` : `☆ ${t('history.favorite')}`}
        </Button>
        {!renaming && (
          <Button
            onClick={() => {
              setDraft(entry.name ?? '');
              setRenaming(true);
            }}
          >
            {t('history.rename')}
          </Button>
        )}
        <Button
          onClick={() =>
            api
              .historyExport({ agent: entry.agent, id: entry.id, host: entry.host })
              .then((path) => path && setNote(t('history.exported', { path })))
              .catch((e: Error) => onError(e.message))
          }
        >
          {t('history.export')}
        </Button>
      </ModalActions>
      {note && <ModalNote>{note}</ModalNote>}
      {left !== null && (
        <ModalNote warn>
          {left === 0 ? t('history.expiresSoon') : t('history.expires', { n: String(left) })}
        </ModalNote>
      )}
      {!entry.projectId && <ModalNote>{t('history.notProject')}</ModalNote>}
      <MetaList>
        <MetaRow label={t('history.meta.agent')}>
          <Badge tone={entry.agent}>{agentName}</Badge>
          {entry.account && (
            <Badge tone={`account-${entry.account}`}>
              {accountLabel(t, entry.account, config.accounts[entry.account])}
            </Badge>
          )}
        </MetaRow>
        <MetaRow label={t('history.meta.last')}>{date(entry.updatedAt)}</MetaRow>
        <MetaRow label={t('history.meta.started')}>{date(entry.startedAt)}</MetaRow>
        {project && <MetaRow label={t('history.meta.project')}>{project.name}</MetaRow>}
        {entry.host && (
          <MetaRow label={t('history.meta.host')} mono>
            {entry.host}
          </MetaRow>
        )}
        <MetaRow label={t('history.meta.folder')} mono>
          {entry.cwd}
        </MetaRow>
        {entry.branch && (
          <MetaRow label={t('history.meta.branch')} mono>
            {entry.branch}
          </MetaRow>
        )}
        <MetaRow label={t('history.meta.messages')}>{entry.messages}</MetaRow>
        <MetaRow label={t('history.meta.id')} mono>
          {entry.id}
          <Button
            variant="ghost"
            onClick={() => {
              api.copyText(entry.id);
              setNote(t('history.copied'));
            }}
          >
            {t('history.copyId')}
          </Button>
        </MetaRow>
      </MetaList>
      {snippet && <ModalNote>{t('history.match', { snippet })}</ModalNote>}
      {transcript?.commands && transcript.commands.length > 0 && (
        <ModalGroup label={t('commands.count', { count: String(transcript.commands.length) })}>
          <CommandTimeline commands={transcript.commands} />
        </ModalGroup>
      )}
      {transcript && transcript.messages.length > 0 && (
        <Transcript label={t('history.preview')}>
          {transcript.messages.slice(0, PREVIEW_MESSAGES).map((m, i) => (
            <TranscriptMessage key={i} role={m.role} label={m.role === 'user' ? t('history.you') : agentName}>
              {m.text}
            </TranscriptMessage>
          ))}
          {(transcript.truncated || transcript.messages.length > PREVIEW_MESSAGES) && (
            <ModalNote>{t('history.truncated')}</ModalNote>
          )}
        </Transcript>
      )}
    </>
  );
}
