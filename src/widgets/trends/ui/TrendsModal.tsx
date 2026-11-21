import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import {
  Button,
  Dot,
  Modal,
  ModalActions,
  ModalBullets,
  ModalDetail,
  ModalEmpty,
  ModalGroup,
  ModalItem,
  ModalList,
  ModalNote,
  ModalSearch,
  ModalTools,
  Segment,
} from '@design-system/react';
import type { CliNews, CliRelease, Language, NewsItem } from '@/shared/api';
import { useT } from '@/shared/i18n';
import {
  bucketIndustry,
  filterCli,
  relativeTime,
  releaseId,
  rowIds,
  SOURCE_NAMES,
  SUMMARY_ID,
  summaryLines,
  TOOL_NAMES,
  type TrendsTab,
} from '../model/trends';
import type { Trends } from '../model/useTrends';

interface Props {
  open: boolean;
  onClose: () => void;
  trends: Trends;
  language: Language;
  /** Claude account the opt-in summary runs with (the current local project's); undefined = the shared one. */
  account?: string;
}

/**
 * AI trends (T35): the guide's list + detail modal with its own title and icon. "My CLIs": releases newer than the
 * installed claude / codex, 3–5 "Added" lines each. "Industry": titles, links and excerpts by keyword group, and an
 * opt-in Claude summary. Opening it is what fetches (cache older than 30 min); rows newer than the previous visit get
 * a dot.
 */
export default function TrendsModal({ open, onClose, trends, language, account }: Props) {
  const t = useT();
  const { state, opened, refresh, summarize } = trends;
  const baseId = useId();
  const listId = `${baseId}-list`;
  const [tab, setTab] = useState<TrendsTab>('cli');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState(0);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const locale = language === 'ko' ? 'ko-KR' : 'en-US';

  // Every opening: fresh search, "new" relative to the previous visit, then mark everything seen.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedId(null);
    setSummaryError(null);
    setNow(Date.now());
    setLastSeen(state?.seenAt ?? 0);
    // CLI tab first when a CLI has a newer release (or nothing was fetched yet: this opening fetches), else industry.
    setTab(!state?.fetchedAt || state.cli.some((c) => !c.upToDate && c.installed) ? 'cli' : 'industry');
    opened();
    // Only on open: state changes while it's open must not reset the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cli = useMemo(() => filterCli(state?.cli ?? [], query), [state, query]);
  const buckets = useMemo(() => bucketIndustry(state?.industry ?? [], query), [state, query]);
  const ids = useMemo(() => rowIds(tab, cli, buckets), [tab, cli, buckets]);
  const selected = selectedId && ids.includes(selectedId) ? selectedId : (ids[0] ?? null);
  const optionId = (id: string) => `${baseId}-${id.replace(/[^\w-]/g, '_')}`;
  const ago = (ms: number) => relativeTime(ms, now, t, locale);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || !ids.length) return; // Korean IME: arrows belong to the composition.
    const down = e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n');
    const up = e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p');
    if (e.key === 'Enter' && selected) {
      const url = urlOf(selected);
      if (url) trends.open(url);
      return;
    }
    if (!down && !up) return;
    e.preventDefault();
    const i = selected ? ids.indexOf(selected) : -1;
    setSelectedId(ids[(i + (down ? 1 : ids.length - 1)) % ids.length]);
  };

  const releaseOf = (id: string): [CliNews, CliRelease] | null => {
    for (const c of cli) for (const r of c.releases) if (releaseId(c.tool, r) === id) return [c, r];
    return null;
  };
  const itemOf = (id: string): NewsItem | undefined => state?.industry.find((i) => i.id === id);
  const urlOf = (id: string) => releaseOf(id)?.[1].url ?? itemOf(id)?.url;

  const runSummary = () => {
    setSummaryError(null);
    void summarize(language, account).then(setSummaryError);
  };

  const fresh = (at: number | null) => at !== null && at > lastSeen;
  const newDot = <Dot status="working" label={t('trends.new')} />;

  const footer = (
    <>
      <span>
        {state?.loading
          ? t('trends.loading')
          : state?.fetchedAt
            ? t('trends.updated', { ago: ago(state.fetchedAt) })
            : t('trends.never')}
      </span>
      {state && state.failed.length > 0 && (
        <span>{t('trends.failed', { sources: state.failed.map((s) => SOURCE_NAMES[s]).join(', ') })}</span>
      )}
    </>
  );

  const list =
    tab === 'cli' ? (
      cli.map((c) => (
        <ModalGroup
          key={c.tool}
          label={`${TOOL_NAMES[c.tool]} · ${c.installed ? t('trends.installed', { version: c.installed }) : t('trends.notInstalled')}`}
        >
          {c.releases.map((r) => {
            const id = releaseId(c.tool, r);
            return (
              <ModalItem
                key={id}
                id={optionId(id)}
                selected={id === selected}
                label={r.version}
                meta={r.publishedAt ? ago(r.publishedAt) : undefined}
                trailing={!c.upToDate && c.installed && fresh(r.publishedAt) ? newDot : undefined}
                onSelect={() => setSelectedId(id)}
              />
            );
          })}
        </ModalGroup>
      ))
    ) : (
      <>
        <ModalItem
          id={optionId(SUMMARY_ID)}
          selected={selected === SUMMARY_ID}
          label={`✦ ${t('trends.summary')}`}
          meta={state?.summary ? ago(state.summary.at) : undefined}
          onSelect={() => setSelectedId(SUMMARY_ID)}
        />
        {buckets.map((b) => (
          <ModalGroup key={b.key} label={t(`trends.group.${b.key}`)}>
            {b.items.map((i) => (
              <ModalItem
                key={i.id}
                id={optionId(i.id)}
                selected={i.id === selected}
                label={i.title}
                meta={ago(i.publishedAt)}
                trailing={i.groups.length > 0 && fresh(i.publishedAt) ? newDot : undefined}
                onSelect={() => setSelectedId(i.id)}
              />
            ))}
          </ModalGroup>
        ))}
      </>
    );

  const detail = (() => {
    if (!selected) return <ModalEmpty>{state?.loading ? t('trends.loading') : t('trends.empty')}</ModalEmpty>;
    if (selected === SUMMARY_ID) {
      const s = state?.summary;
      return (
        <>
          <ModalDetail heading={t('trends.summary')} text={!s && t('trends.summaryIntro')} />
          {s && <ModalBullets items={summaryLines(s.text)} />}
          <ModalActions>
            <Button
              variant={s ? 'default' : 'primary'}
              disabled={state?.summarizing || !state?.industry.length}
              onClick={runSummary}
            >
              {state?.summarizing ? t('trends.summarizing') : t('trends.summarize')}
            </Button>
          </ModalActions>
          {s && <ModalNote>{t('trends.summaryAt', { ago: ago(s.at) })}</ModalNote>}
          <ModalNote>{t('trends.summaryNote')}</ModalNote>
          {summaryError && <ModalNote warn>{t('trends.summaryFailed', { error: summaryError })}</ModalNote>}
        </>
      );
    }
    const rel = releaseOf(selected);
    if (rel) {
      const [c, r] = rel;
      const intro = !c.installed
        ? t('trends.latestOnly')
        : c.upToDate
          ? t('trends.upToDate')
          : t('trends.newer', { installed: c.installed });
      return (
        <>
          <ModalDetail heading={`${TOOL_NAMES[c.tool]} ${r.version}`} text={intro} />
          {r.added.length ? <ModalBullets items={r.added} /> : <ModalNote>{t('trends.noLines')}</ModalNote>}
          <ModalActions>
            <Button onClick={() => trends.open(r.url)}>{t('trends.releaseNotes')} ↗</Button>
          </ModalActions>
          {r.publishedAt && (
            <ModalNote>
              {new Date(r.publishedAt).toLocaleDateString(locale, { dateStyle: 'medium' })}
            </ModalNote>
          )}
        </>
      );
    }
    const item = itemOf(selected);
    if (!item) return null;
    return (
      <>
        <ModalNote>
          {SOURCE_NAMES[item.source]} ·{' '}
          {new Date(item.publishedAt).toLocaleDateString(locale, { dateStyle: 'medium' })}
          {item.groups.length > 0 && ` · ${item.groups.map((g) => t(`trends.group.${g}`)).join(', ')}`}
        </ModalNote>
        <ModalDetail heading={item.title} text={item.excerpt || undefined} />
        <ModalActions>
          <Button variant="primary" onClick={() => trends.open(item.url)}>
            {t('trends.openLink')} ↗
          </Button>
          {item.discussion && item.discussion !== item.url && (
            <Button onClick={() => trends.open(item.discussion as string)}>{t('trends.discussion')} ↗</Button>
          )}
        </ModalActions>
      </>
    );
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('trends.title')}
      subtitle={t('trends.subtitle')}
      closeLabel={t('action.close')}
      footer={footer}
      aside={
        <>
          <ModalSearch
            value={query}
            placeholder={t('trends.search')}
            aria-label={t('trends.search')}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={selected ? optionId(selected) : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <ModalTools>
            <Segment
              label={t('trends.tabs')}
              options={[
                { value: 'cli', label: t('trends.tab.cli') },
                { value: 'industry', label: t('trends.tab.industry') },
              ]}
              value={tab}
              onChange={(v) => {
                setTab(v);
                setSelectedId(null);
              }}
            />
            <Button
              variant="ghost"
              icon
              disabled={state?.loading}
              onClick={refresh}
              title={t('trends.refresh')}
              aria-label={t('trends.refresh')}
            >
              ↻
            </Button>
          </ModalTools>
          <ModalList id={listId} label={t('trends.list')}>
            {ids.length === 0 && (
              <ModalEmpty>{state?.loading ? t('trends.loading') : t('trends.empty')}</ModalEmpty>
            )}
            {list}
          </ModalList>
        </>
      }
    >
      {detail}
    </Modal>
  );
}
