import type {
  CliNews,
  CliRelease,
  CliTool,
  NewsGroup,
  NewsItem,
  NewsSourceId,
  NewsState,
} from '@/shared/api';
import type { Translate } from '@/shared/i18n';

export const TOOL_NAMES: Record<CliTool, string> = { claude: 'Claude Code', codex: 'Codex' };

/** Proper names, the same in every language. */
export const SOURCE_NAMES: Record<NewsSourceId, string> = {
  'claude-code': 'Claude Code',
  'claude-changelog': 'Claude Code CHANGELOG',
  codex: 'Codex',
  'codex-latest': 'Codex (latest)',
  openai: 'OpenAI News',
  cursor: 'Cursor',
  antigravity: 'Antigravity',
  simonw: 'Simon Willison',
  'latent-space': 'Latent Space',
  hn: 'Hacker News',
};

export const GROUP_ORDER: readonly NewsGroup[] = ['subagent', 'hook', 'agentView', 'ade', 'harness'];

export type TrendsTab = 'cli' | 'industry';

/** The industry tab's first row: the opt-in Claude summary. */
export const SUMMARY_ID = 'summary';

export const releaseId = (tool: CliTool, r: CliRelease) => `${tool}@${r.version}`;

export interface IndustryBucket {
  /** A keyword group, or 'latest' for the rest. */
  key: NewsGroup | 'latest';
  items: NewsItem[];
}

/** Items matching the query (title / excerpt / source), under their first keyword group; the rest under "latest". */
export function bucketIndustry(items: NewsItem[], query: string): IndustryBucket[] {
  const q = query.trim().toLowerCase();
  const hits = q
    ? items.filter((i) => `${i.title} ${i.excerpt} ${SOURCE_NAMES[i.source]}`.toLowerCase().includes(q))
    : items;
  const buckets: IndustryBucket[] = GROUP_ORDER.map((key) => ({
    key,
    items: hits.filter((i) => i.groups[0] === key),
  }));
  buckets.push({ key: 'latest', items: hits.filter((i) => i.groups.length === 0) });
  return buckets.filter((b) => b.items.length > 0);
}

/** CLI releases matching the query (version or an "Added" line). */
export function filterCli(cli: CliNews[], query: string): CliNews[] {
  const q = query.trim().toLowerCase();
  if (!q) return cli;
  return cli.map((c) => ({
    ...c,
    releases: c.releases.filter(
      (r) =>
        r.version.includes(q) ||
        TOOL_NAMES[c.tool].toLowerCase().includes(q) ||
        r.added.some((l) => l.toLowerCase().includes(q)),
    ),
  }));
}

/** List order of the rows (↑↓ follow it). */
export function rowIds(tab: TrendsTab, cli: CliNews[], buckets: IndustryBucket[]): string[] {
  if (tab === 'cli') return cli.flatMap((c) => c.releases.map((r) => releaseId(c.tool, r)));
  return [SUMMARY_ID, ...buckets.flatMap((b) => b.items.map((i) => i.id))];
}

export function relativeTime(ms: number, now: number, t: Translate, locale: string): string {
  const min = Math.floor((now - ms) / 60_000);
  if (min < 1) return t('history.ago.now');
  if (min < 60) return t('history.ago.min', { n: String(min) });
  const h = Math.floor(min / 60);
  if (h < 24) return t('history.ago.hour', { n: String(h) });
  const d = Math.floor(h / 24);
  if (d < 30) return t('history.ago.day', { n: String(d) });
  return new Date(ms).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Summary text → its bullet lines (the prompt asks for "- " bullets; anything else stays one line). */
export function summaryLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim())
    .filter(Boolean);
}

/** The AI trends button's dot: the cached state already knows a CLI release newer than the installed one (no fetch for it). */
export function hasCliUpdate(state: Pick<NewsState, 'cli'> | null): boolean {
  return !!state?.cli.some((c) => c.installed !== null && !c.upToDate && c.releases.length > 0);
}
