// AI trends (T35): what's new in the user's CLIs and in the field. Fetched only when the user opens the modal (or
// clicks ↻) — never in the background — into ~/.aquila/news-cache.json; the renderer gets titles, links and short
// excerpts only. Parsers are pure (tested
// against trimmed real feeds in fixtures/news); fetching goes through an injected fetcher.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP_DIR } from './config';
import { binaryFor, parseVersion } from './detect';
import type {
  CliNews,
  CliRelease,
  CliTool,
  Language,
  NewsGroup,
  NewsItem,
  NewsSourceId,
  NewsState,
  NewsSummary,
} from '../src/shared/api/types';

export const NEWS_CACHE_PATH = path.join(APP_DIR, 'news-cache.json');
/** Opening the modal again within this reuses the cache instead of fetching again. */
export const FRESH_MS = 30 * 60_000;
/** Industry items not seen yet are kept this long… */
const INDUSTRY_DAYS = 30;
/** …and ones already seen (published before the last opening) only this long. */
const SEEN_DAYS = 7;
/** Per source, so a busy feed (OpenAI, HN) can't crowd out a quiet one (Cursor, Antigravity). */
const MAX_PER_SOURCE = 15;
const EXCERPT_CHARS = 220;
/** CLI tab: "Added" lines per release. */
const MAX_ADDED = 5;
/** Releases shown per CLI when several are newer than the installed one. */
const MAX_RELEASES = 5;
/** First opening: only the last week gets the "new" dot. */
const FIRST_SEEN_WINDOW_MS = 7 * 24 * 60 * 60_000;

// ── Sources ──────────────────────────────────────────────────────────────────

type SourceKind = 'releases' | 'releases-atom' | 'changelog' | 'feed' | 'hn';

interface SourceDef {
  id: NewsSourceId;
  kind: SourceKind;
  url: (now: number) => string;
  tool?: CliTool;
  headers?: Record<string, string>;
}

const fixed = (u: string) => () => u;
const DAY_S = 86_400;

export const CLAUDE_CHANGELOG_URL = 'https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md';

export const SOURCES: readonly SourceDef[] = [
  // Releases as GitHub's Atom feeds (last 10, ~300 KB, no API rate limit) rather than the REST API (assets make a
  // 30-release page ~10 MB).
  {
    id: 'claude-code',
    kind: 'releases-atom',
    tool: 'claude',
    url: fixed('https://github.com/anthropics/claude-code/releases.atom'),
  },
  {
    // Only the top 64 KB (~20 versions) of a 1.3 MB file.
    id: 'claude-changelog',
    kind: 'changelog',
    tool: 'claude',
    url: fixed('https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md'),
    headers: { Range: 'bytes=0-65535' },
  },
  { id: 'codex', kind: 'releases-atom', tool: 'codex', url: fixed('https://github.com/openai/codex/releases.atom') },
  {
    // Codex ships many alphas: the feed's 10 entries can all be pre-releases. The latest stable one, always.
    id: 'codex-latest',
    kind: 'releases',
    tool: 'codex',
    url: fixed('https://api.github.com/repos/openai/codex/releases/latest'),
  },
  { id: 'openai', kind: 'feed', url: fixed('https://openai.com/news/rss.xml') },
  { id: 'cursor', kind: 'feed', url: fixed('https://cursor.com/changelog/rss.xml') },
  { id: 'antigravity', kind: 'feed', url: fixed('https://antigravity.google/blog/rss.xml') },
  { id: 'simonw', kind: 'feed', url: fixed('https://simonwillison.net/atom/everything/') },
  { id: 'latent-space', kind: 'feed', url: fixed('https://www.latent.space/feed') },
  {
    // Rounded to the day so the URL (and its ETag) stays the same between refreshes.
    id: 'hn',
    kind: 'hn',
    url: (now) => {
      const since = Math.floor(now / 1000 / DAY_S) * DAY_S - 7 * DAY_S;
      return `https://hn.algolia.com/api/v1/search_by_date?tags=story&numericFilters=points%3E100,created_at_i%3E${since}&hitsPerPage=200`;
    },
  },
];

// ── Text helpers ─────────────────────────────────────────────────────────────

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const unwrapCdata = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');

/** Feed HTML (often entity-escaped twice) → one line of plain text. */
export function plainText(html: string): string {
  let s = unwrapCdata(html);
  // Escaped markup (`&lt;p&gt;`) first becomes markup, then goes with the rest.
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    // Inline tags join their text ("(<a>#1</a>)" → "(#1)"); block tags separate words.
    .replace(/<\/?(?:a|code|strong|em|b|i|span|kbd|sub|sup)(?:\s[^>]*)?>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  return decodeEntities(s).replace(/\s+/g, ' ').trim();
}

export function excerpt(text: string, max = EXCERPT_CHARS): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
}

/** Markdown bullet → plain line: no links, emphasis, code ticks or trailing PR refs. */
export function cleanBullet(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s*\((?:#\d+(?:,\s*)?)+\)\s*$/, '')
    .replace(/\s*by @[\w-]+ in https?:\/\/\S+$/, '')
    .trim();
}

// ── Versions ─────────────────────────────────────────────────────────────────

/** `v2.1.329`, `rust-v0.170.0` → `2.1.329`; null when the tag holds no version. */
export function tagVersion(tag: string): string | null {
  const m = /(\d+\.\d+(?:\.\d+)?)(-[\w.]+)?$/.exec(tag.trim());
  return m ? m[1] + (m[2] ?? '') : null;
}

/** Numeric compare of dotted versions; a pre-release suffix sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const [ca, pa = ''] = a.split('-', 2);
  const [cb, pb = ''] = b.split('-', 2);
  const na = ca.split('.').map(Number);
  const nb = cb.split('.').map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return d;
  }
  if (pa === pb) return 0;
  if (!pa) return 1;
  if (!pb) return -1;
  return pa < pb ? -1 : 1;
}

// ── Releases ─────────────────────────────────────────────────────────────────

const ADDED_HEADING = /^#{1,4}\s*(new features?|features?|added|highlights?|what'?s new)\b/i;
const ANY_HEADING = /^#{1,6}\s/;
const BULLET = /^\s*[-*+]\s+\S/;

/**
 * 3–5 "Added" lines of a release body: bullets starting with "Added" (Claude Code), else the bullets under a
 * "New Features" / "Added" / "Highlights" heading (Codex), else the first bullets.
 */
export function addedLines(body: string, max = MAX_ADDED): string[] {
  const lines = body.split(/\r?\n/);
  const bullets = lines.filter((l) => BULLET.test(l) && !/^\s{2,}/.test(l));
  const added = bullets.filter((l) => /^\s*[-*+]\s+(added|new)\b/i.test(l));
  if (added.length) return added.slice(0, max).map(cleanBullet);
  const under: string[] = [];
  let inAdded = false;
  for (const l of lines) {
    if (ANY_HEADING.test(l)) inAdded = ADDED_HEADING.test(l);
    else if (inAdded && BULLET.test(l) && !/^\s{2,}/.test(l)) under.push(l);
  }
  if (under.length) return under.slice(0, max).map(cleanBullet);
  return bullets.slice(0, max).map(cleanBullet);
}

type Json = Record<string, unknown>;
const str = (o: Json, k: string): string | undefined =>
  typeof o[k] === 'string' ? (o[k] as string) : undefined;

/** GitHub Releases API reply → stable releases, newest first. Drafts, pre-releases and unparseable tags skipped. */
export function parseReleases(text: string): CliRelease[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  // `/releases/latest` is one object, `/releases` a list.
  const list: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const out: CliRelease[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Json;
    if (o.prerelease === true || o.draft === true) continue;
    const version = tagVersion(str(o, 'tag_name') ?? '');
    const url = str(o, 'html_url');
    if (!version || version.includes('-') || !url) continue;
    const at = Date.parse(str(o, 'published_at') ?? '');
    out.push({
      version,
      url,
      publishedAt: Number.isFinite(at) ? at : null,
      added: addedLines(str(o, 'body') ?? ''),
    });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/** Release HTML (GitHub renders the Markdown) → Markdown-ish lines `addedLines` reads: `## heading`, `- bullet`. */
export function htmlToMarkdown(html: string): string {
  return unwrapCdata(html)
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, h: string) => `\n## ${plainText(h)}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, li: string) => `\n- ${plainText(li)}\n`)
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((l) => decodeEntities(l).trim())
    .filter(Boolean)
    .join('\n');
}

/** GitHub's `releases.atom` → stable releases, newest first (a `-alpha.1` style version = pre-release, skipped). */
export function parseReleasesAtom(xml: string): CliRelease[] {
  const out: CliRelease[] = [];
  for (const b of xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? []) {
    const url = decodeEntities(atomLink(b) ?? '');
    const version = tagVersion(url.split('/tag/')[1] ?? '') ?? tagVersion(plainText(tag(b, 'title') ?? ''));
    if (!version || version.includes('-') || !isHttp(url)) continue;
    const at = Date.parse((tag(b, 'published') ?? tag(b, 'updated') ?? '').trim());
    out.push({
      version,
      url,
      publishedAt: Number.isFinite(at) ? at : null,
      added: addedLines(htmlToMarkdown(decodeEntities(tag(b, 'content') ?? ''))),
    });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/** Claude Code's CHANGELOG.md (`## 2.1.329` sections) → releases, newest first; only the first `max` sections. */
export function parseChangelog(text: string, max = 20, truncated = false): CliRelease[] {
  const out: CliRelease[] = [];
  const parts = text.split(/^##\s+/m).slice(1);
  // A ranged read (206) cuts the last section somewhere in the middle.
  if (truncated) parts.pop();
  for (const part of parts) {
    if (out.length >= max) break;
    const nl = part.indexOf('\n');
    const version = tagVersion((nl < 0 ? part : part.slice(0, nl)).trim());
    if (!version) continue;
    out.push({
      version,
      url: `${CLAUDE_CHANGELOG_URL}#${version.replace(/\./g, '')}`,
      publishedAt: null,
      added: addedLines(nl < 0 ? '' : part.slice(nl + 1)),
    });
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

/** API releases win (date + link); changelog sections fill versions the API page didn't include or left empty. */
export function mergeReleases(api: CliRelease[], changelog: CliRelease[]): CliRelease[] {
  const byVersion = new Map<string, CliRelease>();
  for (const r of changelog) byVersion.set(r.version, r);
  for (const r of api) {
    const c = byVersion.get(r.version);
    byVersion.set(r.version, r.added.length || !c ? r : { ...r, added: c.added });
  }
  return [...byVersion.values()].sort((a, b) => compareVersions(b.version, a.version));
}

/** Releases newer than the installed version (newest first, capped); none newer → just the latest. */
export function cliNews(tool: CliTool, installed: string | null, releases: CliRelease[]): CliNews {
  const latest = releases[0] ?? null;
  const newer = installed ? releases.filter((r) => compareVersions(r.version, installed) > 0) : [];
  if (newer.length) return { tool, installed, upToDate: false, releases: newer.slice(0, MAX_RELEASES) };
  return { tool, installed, upToDate: !!installed && !!latest, releases: latest ? [latest] : [] };
}

// ── Feeds ────────────────────────────────────────────────────────────────────

function tag(block: string, name: string): string | undefined {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  return re.exec(block)?.[1];
}

function atomLink(block: string): string | undefined {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((a) => /rel=["']alternate["']/i.test(a)) ?? links.find((a) => !/rel=/i.test(a));
  return pick ? /href=["']([^"']+)["']/i.exec(pick)?.[1] : undefined;
}

const isHttp = (u: string) => /^https?:\/\//i.test(u);

/** RSS 2.0 or Atom → items (groups not set yet). Anything unparseable is skipped, never thrown. */
export function parseFeed(xml: string, source: NewsSourceId): NewsItem[] {
  const isAtom = /<feed[\s>]/i.test(xml.slice(0, 2000)) && !/<rss[\s>]/i.test(xml.slice(0, 2000));
  const blocks = xml.match(isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) ?? [];
  const out: NewsItem[] = [];
  for (const b of blocks) {
    const title = plainText(tag(b, 'title') ?? '');
    const link = decodeEntities(
      (isAtom ? atomLink(b) : unwrapCdata(tag(b, 'link') ?? '').trim()) ||
        unwrapCdata(tag(b, 'guid') ?? '').trim(),
    );
    const date = isAtom
      ? (tag(b, 'published') ?? tag(b, 'updated'))
      : (tag(b, 'pubDate') ?? tag(b, 'dc:date') ?? tag(b, 'published'));
    const at = Date.parse(unwrapCdata(date ?? '').trim());
    if (!title || !isHttp(link) || !Number.isFinite(at)) continue;
    const body = isAtom
      ? (tag(b, 'summary') ?? tag(b, 'content'))
      : (tag(b, 'description') ?? tag(b, 'content:encoded'));
    const text = plainText(body ?? '');
    out.push({
      id: `${source}:${link}`,
      source,
      title,
      url: link,
      excerpt: excerpt(text),
      publishedAt: at,
      // From the whole body: the excerpt alone rarely holds the keywords.
      groups: groupsOf(`${title} ${text}`),
    });
  }
  return out;
}

/** Hacker News stories about AI / coding agents (the query already asks for > 100 points). */
const HN_AI =
  /\b(ai|llms?|gpt[\w.-]*|claude|anthropic|openai|codex|gemini|cursor|copilot|agents?|agentic|mcp|vibe[- ]coding|deepseek|mistral|llama|qwen|antigravity|windsurf)\b/i;

export function parseHn(text: string): NewsItem[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  const hits = raw && typeof raw === 'object' ? (raw as { hits?: unknown }).hits : undefined;
  if (!Array.isArray(hits)) return [];
  const out: NewsItem[] = [];
  for (const h of hits) {
    if (!h || typeof h !== 'object') continue;
    const o = h as Json;
    const title = str(o, 'title');
    const id = str(o, 'objectID');
    const at = typeof o.created_at_i === 'number' ? o.created_at_i * 1000 : NaN;
    if (!title || !id || !Number.isFinite(at) || !HN_AI.test(title)) continue;
    const discussion = `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`;
    const url = str(o, 'url');
    const points = typeof o.points === 'number' ? o.points : 0;
    const comments = typeof o.num_comments === 'number' ? o.num_comments : 0;
    out.push({
      id: `hn:${id}`,
      source: 'hn',
      title,
      url: url && isHttp(url) ? url : discussion,
      discussion,
      excerpt: `${points} points · ${comments} comments`,
      publishedAt: at,
      groups: [],
    });
  }
  return out;
}

// ── Keyword groups ───────────────────────────────────────────────────────────

export const GROUPS: readonly [NewsGroup, RegExp][] = [
  ['subagent', /\bsub-?agents?\b|\bmulti-?agents?\b|\bparallel agents\b|\bagent (?:teams?|swarms?|orchestrat\w+)\b|\/swarm\b/i],
  ['hook', /\bhooks?\b/i],
  [
    'agentView',
    /\bagents? (?:view|window|manager|inbox|dashboard|hq)\b|\bmission control\b|\bbackground agents?\b|\bcloud agents?\b/i,
  ],
  // Case-sensitive: "ADE" the acronym, not "made"/"fade".
  ['ade', /\bADEs?\b|\bagentic (?:development|dev|coding) environments?\b/],
  ['harness', /\bharness(?:es)?\b|\bagent (?:loop|scaffold\w*|runtime)s?\b/i],
];

export function groupsOf(text: string): NewsGroup[] {
  return GROUPS.filter(([, re]) => re.test(text)).map(([g]) => g);
}

/** Groups set, recent only, one per link (newest kept), at most 15 per source, newest first. */
export function industry(items: NewsItem[], now: number, seenAt = 0): NewsItem[] {
  const day = 24 * 60 * 60_000;
  const since = now - INDUSTRY_DAYS * day;
  const seenSince = now - SEEN_DAYS * day;
  const byUrl = new Map<string, NewsItem>();
  for (const it of items) {
    if (it.publishedAt < since || it.publishedAt > now + day) continue;
    // Seen already and a week old: gone from the list and the cache.
    if (it.publishedAt <= seenAt && it.publishedAt < seenSince) continue;
    const prev = byUrl.get(it.url);
    if (prev && prev.publishedAt >= it.publishedAt) continue;
    const groups = new Set([...it.groups, ...groupsOf(`${it.title} ${it.excerpt}`)]);
    byUrl.set(it.url, { ...it, groups: GROUPS.map(([g]) => g).filter((g) => groups.has(g)) });
  }
  const perSource = new Map<NewsSourceId, number>();
  return [...byUrl.values()]
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .filter((it) => {
      const n = perSource.get(it.source) ?? 0;
      perSource.set(it.source, n + 1);
      return n < MAX_PER_SOURCE;
    });
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface SourceCache {
  etag?: string;
  lastModified?: string;
  url?: string;
  releases?: CliRelease[];
  items?: NewsItem[];
}

export interface NewsCache {
  v: 1;
  fetchedAt: number | null;
  /** Last opening of the modal. */
  seenAt: number;
  /** The opening before it: items published before then were seen in an earlier visit (pruned after 7 days). */
  prevSeenAt: number;
  /** False until the first opening: the default `seenAt` (a week back) is only for the dots, nothing was seen. */
  openedBefore: boolean;
  sources: Partial<Record<NewsSourceId, SourceCache>>;
  failed: NewsSourceId[];
  summary: NewsSummary | null;
}

const emptyCache = (now: number): NewsCache => ({
  v: 1,
  fetchedAt: null,
  seenAt: now - FIRST_SEEN_WINDOW_MS,
  prevSeenAt: 0,
  openedBefore: false,
  sources: {},
  failed: [],
  summary: null,
});

/** Defensive: a broken or foreign file is a fresh cache, never a throw. */
export function parseCache(text: string, now: number): NewsCache {
  try {
    const raw = JSON.parse(text) as Partial<NewsCache> | null;
    if (!raw || typeof raw !== 'object' || raw.v !== 1) return emptyCache(now);
    return {
      v: 1,
      fetchedAt: typeof raw.fetchedAt === 'number' ? raw.fetchedAt : null,
      seenAt: typeof raw.seenAt === 'number' ? raw.seenAt : now - FIRST_SEEN_WINDOW_MS,
      prevSeenAt: typeof raw.prevSeenAt === 'number' ? raw.prevSeenAt : 0,
      openedBefore: raw.openedBefore === true,
      sources: raw.sources && typeof raw.sources === 'object' ? raw.sources : {},
      failed: Array.isArray(raw.failed) ? raw.failed : [],
      summary: raw.summary && typeof raw.summary.text === 'string' ? raw.summary : null,
    };
  } catch {
    return emptyCache(now);
  }
}

function readCache(file: string, now: number): NewsCache {
  try {
    return parseCache(fs.readFileSync(file, 'utf8'), now);
  } catch {
    return emptyCache(now);
  }
}

function writeCache(file: string, cache: NewsCache): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, file);
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface FetchReply {
  status: number;
  header(name: string): string | null;
  text(): Promise<string>;
}
export type Fetcher = (url: string, headers: Record<string, string>) => Promise<FetchReply>;

const FETCH_HEADERS = { 'User-Agent': 'aquila-agents', Accept: '*/*' };

function installedVersion(tool: CliTool): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(binaryFor(tool), ['--version'], { timeout: 10_000, env: process.env }, (err, stdout, stderr) =>
      resolve(err ? null : parseVersion(`${stdout}\n${stderr}`)),
    );
  });
}

interface ServiceOptions {
  fetcher: Fetcher;
  onChange: (state: NewsState) => void;
  file?: string;
  now?: () => number;
  versions?: (tool: CliTool) => Promise<string | null>;
}

export class NewsService {
  private cache: NewsCache;
  private readonly file: string;
  private readonly now: () => number;
  private readonly versions: (tool: CliTool) => Promise<string | null>;
  private installed: Partial<Record<CliTool, string | null>> = {};
  private loading = false;
  private summarizing = false;
  private running: Promise<NewsState> | null = null;

  constructor(private readonly opts: ServiceOptions) {
    this.file = opts.file ?? NEWS_CACHE_PATH;
    this.now = opts.now ?? Date.now;
    this.versions = opts.versions ?? installedVersion;
    this.cache = readCache(this.file, this.now());
  }

  /** Whether the cache is older than 30 min (or empty). */
  stale(): boolean {
    return this.cache.fetchedAt === null || this.now() - this.cache.fetchedAt >= FRESH_MS;
  }

  state(): NewsState {
    const now = this.now();
    const src = this.cache.sources;
    const claude = mergeReleases(src['claude-code']?.releases ?? [], src['claude-changelog']?.releases ?? []);
    const codex = mergeReleases(src.codex?.releases ?? [], src['codex-latest']?.releases ?? []);
    const cli = [
      cliNews('claude', this.installed.claude ?? null, claude),
      cliNews('codex', this.installed.codex ?? null, codex),
    ];
    const items = industry(
      SOURCES.filter((s) => s.kind === 'feed' || s.kind === 'hn').flatMap((s) => src[s.id]?.items ?? []),
      now,
      this.cache.prevSeenAt,
    );
    return {
      fetchedAt: this.cache.fetchedAt,
      loading: this.loading,
      summarizing: this.summarizing,
      cli,
      industry: items,
      seenAt: this.cache.seenAt,
      failed: this.cache.failed,
      summary: this.cache.summary,
    };
  }

  /** Re-reads the installed versions and every source; one run at a time. */
  refresh(): Promise<NewsState> {
    this.running ??= this.run().finally(() => (this.running = null));
    return this.running;
  }

  private async run(): Promise<NewsState> {
    this.loading = true;
    this.emit();
    const [claude, codex] = await Promise.all([this.versions('claude'), this.versions('codex')]);
    this.installed = { claude, codex };
    const now = this.now();
    const failed: NewsSourceId[] = [];
    await Promise.all(
      SOURCES.map(async (s) => {
        try {
          await this.fetchSource(s, now);
        } catch (err) {
          failed.push(s.id);
          console.error(`[news] ${s.id}:`, err instanceof Error ? err.message : err);
        }
      }),
    );
    this.cache.fetchedAt = now;
    this.cache.failed = failed.sort();
    this.loading = false;
    this.save();
    return this.emit();
  }

  private async fetchSource(s: SourceDef, now: number): Promise<void> {
    const url = s.url(now);
    const prev = this.cache.sources[s.id];
    const headers: Record<string, string> = { ...FETCH_HEADERS, ...s.headers };
    if (s.kind === 'releases') headers.Accept = 'application/vnd.github+json';
    // Conditional request only for the same URL (HN's changes daily); a 304 keeps what we parsed last time.
    if (prev && prev.url === url) {
      if (prev.etag) headers['If-None-Match'] = prev.etag;
      if (prev.lastModified) headers['If-Modified-Since'] = prev.lastModified;
    }
    const reply = await this.opts.fetcher(url, headers);
    if (reply.status === 304 && prev) return;
    if (reply.status < 200 || reply.status >= 300) throw new Error(`HTTP ${reply.status}`);
    const text = await reply.text();
    const next: SourceCache = {
      url,
      etag: reply.header('etag') ?? undefined,
      lastModified: reply.header('last-modified') ?? undefined,
    };
    if (s.kind === 'releases') next.releases = parseReleases(text);
    else if (s.kind === 'releases-atom') next.releases = parseReleasesAtom(text);
    else if (s.kind === 'changelog') next.releases = parseChangelog(text, 20, reply.status === 206);
    else if (s.kind === 'hn') next.items = parseHn(text);
    else next.items = parseFeed(text, s.id);
    // The cache keeps what the tab can show (OpenAI's feed holds its whole archive).
    if (next.items) next.items = industry(next.items, now, this.cache.prevSeenAt);
    if (!next.releases?.length && !next.items?.length && s.kind !== 'hn') throw new Error('nothing parsed');
    this.cache.sources[s.id] = next;
  }

  /**
   * The modal was opened: everything published until now is seen (the renderer kept the previous `seenAt` for its
   * dots), and the sources are fetched if the cache is older than 30 min. The only automatic fetch there is.
   */
  opened(): NewsState {
    this.cache.prevSeenAt = this.cache.openedBefore ? this.cache.seenAt : 0;
    this.cache.openedBefore = true;
    this.cache.seenAt = this.now();
    this.save();
    if (this.stale()) void this.refresh();
    return this.emit();
  }

  /** Only links we handed out may be opened. */
  isKnownUrl(url: string): boolean {
    if (!isHttp(url)) return false;
    const s = this.state();
    return (
      s.industry.some((i) => i.url === url || i.discussion === url) ||
      s.cli.some((c) => c.releases.some((r) => r.url === url))
    );
  }

  /**
   * Opt-in LLM summary of the industry items (uses the user's Claude quota): a hidden `claude -p` with the
   * titles and excerpts only, no tools.
   */
  async summarize(language: Language, configDir: string | undefined): Promise<NewsState> {
    if (this.summarizing) return this.state();
    this.summarizing = true;
    this.emit();
    try {
      const items = this.state().industry.slice(0, 40);
      if (!items.length) throw new Error('no items');
      const text = await runClaude(summaryPrompt(items, language), configDir);
      this.cache.summary = { text, at: this.now(), language };
      this.save();
    } finally {
      this.summarizing = false;
    }
    return this.emit();
  }

  private save(): void {
    // Seen-and-old / expired items leave the file too (a 304 keeps a source's items without re-parsing them).
    const now = this.now();
    for (const c of Object.values(this.cache.sources))
      if (c?.items) c.items = industry(c.items, now, this.cache.prevSeenAt);
    try {
      writeCache(this.file, this.cache);
    } catch (err) {
      console.error('[news] cache write failed', err);
    }
  }

  private emit(): NewsState {
    const s = this.state();
    this.opts.onChange(s);
    return s;
  }
}

export function summaryPrompt(items: NewsItem[], language: Language): string {
  const lang = language === 'ko' ? 'Korean' : 'English';
  const list = items.map((i) => `- [${i.source}] ${i.title}${i.excerpt ? ` — ${i.excerpt}` : ''}`).join('\n');
  return [
    `Summarize what matters for a developer who uses AI coding agents (Claude Code, Codex, Cursor) in these news items.`,
    `Write 3–6 short bullet points in ${lang}, plain text with "- " bullets, no headings, no preamble.`,
    `Use only the items below; don't invent anything, don't use tools.`,
    '',
    list,
  ].join('\n');
}

const SUMMARY_TIMEOUT_MS = 90_000;

function runClaude(prompt: string, configDir: string | undefined): Promise<string> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_CHILD_SESSION;
  if (configDir) env.CLAUDE_CONFIG_DIR = configDir;
  return new Promise((resolve, reject) => {
    // Prompt on stdin (it's long); no session file, one turn, the small model.
    const child = spawn(
      binaryFor('claude'),
      ['-p', '--no-session-persistence', '--max-turns', '1', '--model', 'haiku', '--output-format', 'text'],
      { cwd: os.homedir(), env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => (err += d.toString('utf8')));
    const timer = setTimeout(() => child.kill(), SUMMARY_TIMEOUT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code === 0 && text) resolve(text);
      else reject(new Error(err.trim().split('\n')[0] || text.split('\n')[0] || `claude exited ${code}`));
    });
    child.stdin.end(prompt);
  });
}

/**
 * Smoke: serves the trimmed real feeds in `electron/fixtures/news` instead of the network (HN: no hits), so the
 * parsers and the modal run without touching the user's cache or the internet.
 */
/** When the fixtures were captured: smoke and capture run the news service at this time. */
export const FIXTURE_NOW = Date.parse('2026-11-20T09:00:00Z');

export function fixtureFetcher(dir: string): Fetcher {
  const files: [RegExp, string][] = [
    [/anthropics\/claude-code\/releases\.atom/, 'claude-releases.atom'],
    [/CHANGELOG\.md/, 'claude-changelog.md'],
    [/openai\/codex\/releases\.atom/, 'codex-releases.atom'],
    [/openai\/codex\/releases\/latest/, 'codex-latest.json'],
    [/openai\.com/, 'openai.xml'],
    [/cursor\.com/, 'cursor.xml'],
    [/antigravity/, 'antigravity.xml'],
    [/simonwillison/, 'simonw.xml'],
    [/latent\.space/, 'latent-space.xml'],
  ];
  return async (url) => {
    const name = files.find(([re]) => re.test(url))?.[1];
    const body = name ? fs.readFileSync(path.join(dir, name), 'utf8') : '{"hits":[]}';
    return { status: 200, header: () => null, text: async () => body };
  };
}
