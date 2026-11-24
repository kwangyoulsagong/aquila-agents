import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addedLines,
  cleanBullet,
  cliNews,
  compareVersions,
  excerpt,
  groupsOf,
  industry,
  mergeReleases,
  NewsService,
  parseCache,
  parseDate,
  readHead,
  summaryPrompt,
  AI_TOPIC,
  parseChangelog,
  parseFeed,
  parseHn,
  parseHfPapers,
  parseGithubSearch,
  parseReleases,
  plainText,
  FRESH_MS,
  htmlToMarkdown,
  parseReleasesAtom,
  SOURCES,
  tagVersion,
  type FetchReply,
  type Fetcher,
} from './news';
import { NEWS_REGION, type NewsItem } from '../src/shared/api/types';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', 'news', name), 'utf8');
const NOW = Date.parse('2026-11-20T09:00:00Z');

const dirs: string[] = [];
const tmpFile = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'aquila-news-'));
  dirs.push(d);
  return path.join(d, 'news-cache.json');
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('versions', () => {
  it('reads versions out of tags', () => {
    expect(tagVersion('v2.1.329')).toBe('2.1.329');
    expect(tagVersion('rust-v0.170.0')).toBe('0.170.0');
    expect(tagVersion('rust-v0.172.0-alpha.2')).toBe('0.172.0-alpha.2');
    expect(tagVersion('latest')).toBeNull();
  });

  it('compares numerically, pre-releases first', () => {
    expect(compareVersions('2.1.10', '2.1.9')).toBeGreaterThan(0);
    expect(compareVersions('0.170.0', '0.170.0')).toBe(0);
    expect(compareVersions('0.172.0-alpha.1', '0.172.0')).toBeLessThan(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
  });
});

describe('text', () => {
  it('turns double-escaped feed HTML into one plain line', () => {
    expect(plainText('&lt;p&gt;&lt;strong&gt;Hi&lt;/strong&gt; &amp;amp; bye&lt;/p&gt;')).toBe('Hi & bye');
    expect(plainText('<![CDATA[<p>One</p>\n<p>Two &#8217;s</p>]]>')).toBe('One Two ’s');
  });

  it('cuts excerpts on a word', () => {
    const e = excerpt('word '.repeat(100), 40);
    expect(e.length).toBeLessThanOrEqual(41);
    expect(e.endsWith('word…')).toBe(true);
  });

  it('cleans markdown bullets', () => {
    expect(cleanBullet('- Added `/foo` with [docs](https://x.y) (#61172)')).toBe('Added /foo with docs');
    expect(cleanBullet('* **Bold** thing (#1, #2)')).toBe('Bold thing');
  });
});

describe('releases', () => {
  it('Codex Atom feed: skips pre-releases, takes the New Features bullets from the HTML', () => {
    const r = parseReleasesAtom(fixture('codex-releases.atom'));
    expect(r.map((x) => x.version)).toEqual(['0.171.0']);
    expect(r[0].url).toBe('https://github.com/openai/codex/releases/tag/rust-v0.171.0');
    expect(r[0].added[0]).toBe(
      'Added GPT-6.2 Sol and Astra to model catalogs, with Sol as the default catalog selection.',
    );
    expect(r[0].added.every((l) => !/<|&lt;|\(#\d+\)/.test(l))).toBe(true);
    expect(r[0].publishedAt).not.toBeNull();
  });

  it('Claude Code Atom feed: "Added" lines, newest first, at most five', () => {
    const r = parseReleasesAtom(fixture('claude-releases.atom'));
    expect(r.map((x) => x.version)).toEqual(['2.1.329', '2.1.328', '2.1.327']);
    expect(r[0].added.length).toBeGreaterThanOrEqual(3);
    expect(r[0].added.length).toBeLessThanOrEqual(5);
    expect(r[0].added.every((l) => l.startsWith('Added'))).toBe(true);
  });

  it('REST /releases/latest (one object) and a list', () => {
    const one = parseReleases(fixture('codex-latest.json'));
    expect(one.map((x) => x.version)).toEqual(['0.171.0']);
    expect(one[0].added.length).toBeGreaterThan(0);
    const list = parseReleases(
      JSON.stringify([
        { tag_name: 'v1.0.0', html_url: 'https://x/1', body: '- Added a' },
        { tag_name: 'v1.1.0-beta', html_url: 'https://x/2', prerelease: true },
      ]),
    );
    expect(list.map((x) => x.version)).toEqual(['1.0.0']);
  });

  it('turns release HTML into bullets', () => {
    expect(
      htmlToMarkdown('<h2>New Features</h2><ul><li>Added <code>x</code> (<a href="#">#1</a>)</li></ul>'),
    ).toBe('## New Features\n- Added x (#1)');
  });

  it('never throws on junk', () => {
    expect(parseReleases('not json')).toEqual([]);
    expect(parseReleases('{"message":"API rate limit exceeded"}')).toEqual([]);
  });

  it('falls back to the first bullets when there is no Added section', () => {
    expect(addedLines('## Bug Fixes\n- Fixed a\n- Fixed b')).toEqual(['Fixed a', 'Fixed b']);
  });

  it('drops the cut-off last section of a ranged CHANGELOG read', () => {
    const text = fixture('claude-changelog.md');
    expect(parseChangelog(text, 20, true).map((x) => x.version)).toEqual(['2.1.329', '2.1.328']);
  });

  it('parses the CHANGELOG and merges it under the API releases', () => {
    const log = parseChangelog(fixture('claude-changelog.md'));
    expect(log.map((x) => x.version)).toEqual(['2.1.329', '2.1.328', '2.1.327']);
    expect(log[0].added[0]).toBe(
      "Added a trust dialog warning that says where a folder's hooks are declared",
    );
    expect(log[0].url).toContain('CHANGELOG.md#21329');
    const api = [{ version: '2.1.329', url: 'https://gh/r', publishedAt: 1, added: [] }];
    const merged = mergeReleases(api, log);
    expect(merged[0]).toMatchObject({ version: '2.1.329', url: 'https://gh/r', publishedAt: 1 });
    expect(merged[0].added).toEqual(log[0].added);
    expect(merged).toHaveLength(3);
  });

  it('lists releases newer than the installed one, else the latest', () => {
    const rel = parseChangelog(fixture('claude-changelog.md'));
    expect(cliNews('claude', '2.1.327', rel)).toMatchObject({ upToDate: false });
    expect(cliNews('claude', '2.1.327', rel).releases.map((r) => r.version)).toEqual(['2.1.329', '2.1.328']);
    const cur = cliNews('claude', '2.1.329', rel);
    expect(cur.upToDate).toBe(true);
    expect(cur.releases.map((r) => r.version)).toEqual(['2.1.329']);
    expect(cliNews('codex', null, rel).upToDate).toBe(false);
    expect(cliNews('codex', '1.0.0', []).releases).toEqual([]);
  });
});

describe('feeds', () => {
  it('RSS with CDATA (OpenAI)', () => {
    const items = parseFeed(fixture('openai.xml'), 'openai');
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      source: 'openai',
      title: 'How OpenAI’s Performance Factory keeps ChatGPT fast',
      url: 'https://openai.com/index/how-openai-performance-factory-keeps-chatgpt-fast',
      publishedAt: Date.parse('Thu, 19 Nov 2026 08:00:00 GMT'),
    });
    expect(items[0].excerpt).toMatch(/^Learn how OpenAI built/);
  });

  it('RSS without a description (Antigravity) and with escaped titles (Latent Space)', () => {
    const ag = parseFeed(fixture('antigravity.xml'), 'antigravity');
    expect(ag.map((i) => i.title)).toEqual([
      'Gemini 4 Neon in Google Antigravity',
      'Gemini 4 Hydrogen and Orchestrator',
    ]);
    expect(ag[0].excerpt).toBe('');
    const ls = parseFeed(fixture('latent-space.xml'), 'latent-space');
    expect(ls[1].title).toBe("[AINews] Gemini 4 Neon: GDM's Opus/Sol Contender");
    expect(ls[0].excerpt.startsWith('>50% of tickets')).toBe(true);
    const cursor = parseFeed(fixture('cursor.xml'), 'cursor');
    expect(cursor[0]).toMatchObject({
      title: 'Voice Chat with Agents',
      url: 'https://cursor.com/changelog/voice-chat',
    });
  });

  it('Atom (Simon Willison): alternate link, escaped HTML summary', () => {
    const items = parseFeed(fixture('simonw.xml'), 'simonw');
    expect(items.map((i) => i.title)).toEqual(['PostgreSQL 19 Released', 'llm-gemini 0.38']);
    expect(items[0].url).toBe('https://simonwillison.net/2026/Nov/19/postgresql-19/');
    expect(items[0].excerpt).toMatch(/^PostgreSQL 19 Released Most years/);
    expect(items[0].excerpt).not.toMatch(/[<>]|&lt;/);
    expect(items[0].excerpt.length).toBeLessThanOrEqual(221);
  });

  it('skips broken items and never throws', () => {
    expect(parseFeed('<rss><item><title>x</title></item></rss>', 'openai')).toEqual([]);
    expect(parseFeed('garbage', 'openai')).toEqual([]);
  });

  it('Hacker News: AI stories only, discussion link kept', () => {
    const json = JSON.stringify({
      hits: [
        {
          objectID: '1',
          title: 'Claude Code hooks deep dive',
          url: 'https://ex.com/a',
          points: 300,
          num_comments: 80,
          created_at_i: 1795113317,
        },
        {
          objectID: '2',
          title: 'The 98% Slot Machine',
          url: 'https://ex.com/b',
          points: 181,
          created_at_i: 1795113317,
        },
        { objectID: '3', title: 'Ask HN: Which LLM do you use?', points: 150, created_at_i: 1795113317 },
      ],
    });
    const items = parseHn(json);
    expect(items.map((i) => i.id)).toEqual(['hn:1', 'hn:3']);
    expect(items[0]).toMatchObject({
      url: 'https://ex.com/a',
      discussion: 'https://news.ycombinator.com/item?id=1',
    });
    expect(items[0].excerpt).toBe('300 points · 80 comments');
    expect(items[1].url).toBe('https://news.ycombinator.com/item?id=3');
    expect(parseHn('nope')).toEqual([]);
  });
});

describe('technical sources', () => {
  it('Hugging Face papers: with code, developer topics, most upvoted first, at most 10', () => {
    const items = parseHfPapers(fixture('hf-papers.json'));
    expect(items.length).toBe(10);
    expect(
      items.every((i) => i.source === 'hf-papers' && i.url.startsWith('https://huggingface.co/papers/')),
    ).toBe(true);
    expect(items[0].title).toBe('Jeveration: System One Models Now Generate');
    expect(items[0].excerpt).toMatch(/^▲ 152 · github\.com\//);
    // No repo (39 upvotes) or no developer topic: left out.
    expect(items.some((i) => i.title.startsWith('The Resolution Hypothesis'))).toBe(false);
    expect(items.some((i) => i.title.startsWith('PROLA'))).toBe(false);
    expect(parseHfPapers('nope')).toEqual([]);
    expect(parseHfPapers('{"hits":[]}')).toEqual([]);
  });

  it('new GitHub repos: name, stars, language and description', () => {
    const items = parseGithubSearch(fixture('github-new.json'));
    expect(items).toHaveLength(15);
    expect(items[0]).toMatchObject({
      id: 'github-new:erkamyaman/rust-anything',
      source: 'github-new',
      title: 'erkamyaman/rust-anything',
      url: 'https://github.com/erkamyaman/rust-anything',
      publishedAt: Date.parse('2026-11-16T12:10:36Z'),
    });
    expect(items[0].excerpt).toMatch(/^★ 8,898 · /);
    expect(parseGithubSearch('{"message":"API rate limit exceeded"}')).toEqual([]);
  });

  it('the GitHub search URL stays the same within a day', () => {
    const src = SOURCES.find((s) => s.id === 'github-new');
    expect(src?.url(NOW)).toBe(src?.url(NOW + 60_000));
    expect(decodeURIComponent(src?.url(NOW) ?? '')).toContain('created:>2026-11-13');
  });

  it('the industry list drops business news from every source', () => {
    const base = { url: 'https://x/1', excerpt: '', publishedAt: NOW - 1000, groups: [] };
    const list = industry(
      [
        {
          ...base,
          id: 'a',
          source: 'geeknews',
          title: '젠슨 황 복귀에 엔비디아 주가 31% 급등',
          url: 'https://x/a',
        },
        {
          ...base,
          id: 'b',
          source: 'cursor',
          title: 'Anysphere raises $2B at a $30B valuation',
          url: 'https://x/b',
        },
        { ...base, id: 'c', source: 'cursor', title: 'Background agents in the CLI', url: 'https://x/c' },
        { ...base, id: 'd', source: 'openai', title: 'Our CEO on the future of work', url: 'https://x/d' },
        {
          ...base,
          id: 'e',
          source: 'openai',
          title: 'Introducing the Responses API SDK for agents',
          url: 'https://x/e',
        },
      ],
      NOW,
    );
    expect(list.map((i) => i.id).sort()).toEqual(['c', 'e']);
  });
});

describe('groups and unread', () => {
  it('matches the keyword groups', () => {
    expect(groupsOf('Parallel subagents and new hooks')).toEqual(['subagent', 'hook']);
    expect(groupsOf('Cursor 3: the Agents Window')).toEqual(['agentView']);
    expect(groupsOf('Is the ADE the new IDE?')).toEqual(['ade']);
    expect(groupsOf('made a fade')).toEqual([]);
    expect(groupsOf('Building an agent harness')).toEqual(['harness']);
  });

  const item = (over: Partial<NewsItem>): NewsItem => ({
    id: 'x',
    source: 'cursor',
    title: 't',
    url: 'https://a/1',
    excerpt: '',
    publishedAt: NOW - 1000,
    groups: [],
    ...over,
  });

  it('keeps the last 30 days, one per link, newest first, groups set', () => {
    const list = industry(
      [
        item({ id: 'old', url: 'https://a/old', publishedAt: NOW - 40 * 86_400_000 }),
        item({ id: 'a1', url: 'https://a/1', publishedAt: NOW - 5000 }),
        item({ id: 'a2', url: 'https://a/1', publishedAt: NOW - 2000, title: 'Subagents' }),
        item({ id: 'b', url: 'https://a/2', publishedAt: NOW - 1000 }),
      ],
      NOW,
    );
    expect(list.map((i) => i.id)).toEqual(['b', 'a2']);
    expect(list[1].groups).toEqual(['subagent']);
  });

  it('drops items seen in an earlier visit once they are a week old; unseen ones stay 30 days', () => {
    const day = 86_400_000;
    const prevSeenAt = NOW - 2 * day;
    const list = industry(
      [
        item({ id: 'seen-old', url: 'https://a/1', publishedAt: NOW - 10 * day }),
        item({ id: 'seen-fresh', url: 'https://a/2', publishedAt: NOW - 3 * day }),
        item({ id: 'unseen', url: 'https://a/3', publishedAt: NOW - day }),
      ],
      NOW,
      prevSeenAt,
    );
    expect(list.map((i) => i.id)).toEqual(['unseen', 'seen-fresh']);
    // Never opened before: a 10-day-old item is still there.
    expect(industry([item({ id: 'x', publishedAt: NOW - 10 * day })], NOW, 0)).toHaveLength(1);
  });

  it('feed groups come from the whole body, not just the excerpt', () => {
    const xml = `<rss><channel><item><title>Release</title><link>https://a/b</link><pubDate>Thu, 19 Nov 2026 08:00:00 GMT</pubDate><description>${'word '.repeat(80)} now with subagents</description></item></channel></rss>`;
    const [it] = parseFeed(xml, 'cursor');
    expect(it.excerpt).not.toContain('subagents');
    expect(it.groups).toEqual(['subagent']);
    expect(industry([it], NOW)[0].groups).toEqual(['subagent']);
  });
});

describe('cache', () => {
  it('a broken or foreign file is a fresh cache with a week of "new"', () => {
    for (const text of ['', 'nope', '{"v":2}', 'null']) {
      const c = parseCache(text, NOW);
      expect(c.fetchedAt).toBeNull();
      expect(c.seenAt).toBe(NOW - 7 * 86_400_000);
    }
  });
});

describe('NewsService', () => {
  const replyFor = (url: string): { status: number; body: string; etag?: string } => {
    if (url.includes('claude-code/releases.atom'))
      return { status: 200, body: fixture('claude-releases.atom'), etag: '"cc"' };
    if (url.includes('CHANGELOG.md')) return { status: 206, body: fixture('claude-changelog.md') };
    if (url.includes('codex/releases.atom')) return { status: 200, body: fixture('codex-releases.atom') };
    if (url.includes('codex/releases/latest')) return { status: 200, body: fixture('codex-latest.json') };
    if (url.includes('openai.com')) return { status: 200, body: fixture('openai.xml') };
    if (url.includes('cursor.com')) return { status: 500, body: '' };
    if (url.includes('antigravity')) return { status: 200, body: fixture('antigravity.xml') };
    if (url.includes('simonwillison')) return { status: 200, body: fixture('simonw.xml') };
    if (url.includes('latent.space')) return { status: 200, body: fixture('latent-space.xml') };
    if (url.includes('github.blog/changelog')) return { status: 200, body: fixture('github-changelog.xml') };
    if (url.includes('huggingface.co/blog')) return { status: 200, body: fixture('huggingface.xml') };
    if (url.includes('huggingface.co/api/daily_papers'))
      return { status: 200, body: fixture('hf-papers.json') };
    if (url.includes('api.github.com/search/repositories'))
      return { status: 200, body: fixture('github-new.json') };
    const kr: [string, string][] = [
      ['news.hada.io', 'geeknews.xml'],
      ['d2.naver.com', 'naver-d2.atom'],
      ['tech.kakao.com', 'kakao.xml'],
      ['toss.tech', 'toss.xml'],
      ['woowahan.com', 'woowahan.xml'],
      ['medium.com/feed/daangn', 'daangn.xml'],
      ['lycorp.co.jp', 'lycorp.xml'],
    ];
    const k = kr.find(([host]) => url.includes(host));
    if (k) return { status: 200, body: fixture(k[1]) };
    return { status: 200, body: '{"hits":[]}' };
  };
  type Call = { url: string; headers: Record<string, string> };
  const makeFetcher = (calls: Call[], notModified = false): Fetcher =>
    vi.fn(async (url: string, headers: Record<string, string>): Promise<FetchReply> => {
      calls.push({ url, headers });
      const r = replyFor(url);
      const status = notModified && headers['If-None-Match'] ? 304 : r.status;
      return { status, header: (n) => (n === 'etag' ? (r.etag ?? null) : null), text: async () => r.body };
    });
  const versions = async (tool: 'claude' | 'codex') => (tool === 'claude' ? '2.1.327' : '0.170.0');

  it('fetches nothing by itself: only refresh() / opened() on a stale cache do', async () => {
    const calls: Call[] = [];
    const file = tmpFile();
    let now = NOW;
    const svc = new NewsService({
      fetcher: makeFetcher(calls),
      onChange: () => {},
      file,
      now: () => now,
      versions,
    });
    svc.state();
    expect(calls).toHaveLength(0);
    expect(svc.stale()).toBe(true);
    svc.opened();
    await vi.waitFor(() => expect(svc.state().loading).toBe(false));
    expect(calls).toHaveLength(SOURCES.length);
    // Opened again within 30 min: the cache, no request.
    now += FRESH_MS - 1;
    svc.opened();
    expect(calls).toHaveLength(SOURCES.length);
  });

  it('parses every source, keeps failures out, caches, then uses ETags', async () => {
    const file = tmpFile();
    const calls: Call[] = [];
    let now = NOW;
    const svc = new NewsService({
      fetcher: makeFetcher(calls),
      onChange: () => {},
      file,
      now: () => now,
      versions,
    });
    const s = await svc.refresh();
    expect(calls).toHaveLength(SOURCES.length);
    expect(calls.find((c) => c.url.includes('CHANGELOG'))?.headers.Range).toBe('bytes=0-65535');
    expect(s.failed).toEqual(['cursor']);
    expect(s.cli[0]).toMatchObject({ tool: 'claude', installed: '2.1.327', upToDate: false });
    expect(s.cli[0].releases.map((r) => r.version)).toEqual(['2.1.329', '2.1.328']);
    expect(s.cli[1]).toMatchObject({ tool: 'codex', upToDate: false });
    expect(s.cli[1].releases.map((r) => r.version)).toEqual(['0.171.0']);
    expect(s.industry.length).toBeGreaterThan(5);
    expect(svc.stale()).toBe(false);
    expect(svc.isKnownUrl(s.industry[0].url)).toBe(true);
    expect(svc.isKnownUrl('https://evil.example/')).toBe(false);
    expect(svc.isKnownUrl('file:///etc/passwd')).toBe(false);
    // Technical sources: papers with code and new repos.
    const sources = new Set(s.industry.map((i) => i.source));
    for (const id of ['hf-papers', 'github-new', 'huggingface', 'github-changelog'] as const)
      expect(sources.has(id)).toBe(true);
    // No business story made it through (the Latent Space fixture holds one).
    expect(s.industry.some((i) => /\bARR\b|\bCOO\b/.test(i.title))).toBe(false);
    // Korea tab (T63): GeekNews, Naver D2 and at least one tech blog.
    const krSources = new Set(s.industry.filter((i) => NEWS_REGION[i.source] === 'kr').map((i) => i.source));
    expect(krSources.has('geeknews')).toBe(true);
    expect(krSources.has('naver-d2')).toBe(true);
    expect(['kakao', 'toss', 'woowahan', 'daangn', 'lycorp'].some((b) => krSources.has(b as never))).toBe(
      true,
    );
    expect(calls.find((c) => c.url.includes('toss.tech'))?.headers.Range).toBe('bytes=0-65535');

    // Opened (first time): seen, persisted, nothing pruned yet.
    expect(svc.opened().seenAt).toBe(now);
    const again = new NewsService({ fetcher: makeFetcher([]), onChange: () => {}, file, now: () => now });
    expect(again.state().seenAt).toBe(now);
    expect(again.state().industry.length).toBe(s.industry.length);

    // Later: conditional request, a 304 keeps the parsed releases.
    now += FRESH_MS;
    const calls2: Call[] = [];
    const svc2 = new NewsService({
      fetcher: makeFetcher(calls2, true),
      onChange: () => {},
      file,
      now: () => now,
      versions,
    });
    const s2 = await svc2.refresh();
    expect(calls2.find((c) => c.url.includes('claude-code/releases'))?.headers['If-None-Match']).toBe('"cc"');
    expect(s2.cli[0].releases.map((r) => r.version)).toEqual(['2.1.329', '2.1.328']);
  });

  it('prunes items seen in an earlier visit from the cache file after a week', async () => {
    const file = tmpFile();
    const day = 86_400_000;
    let now = NOW;
    const svc = new NewsService({
      fetcher: makeFetcher([]),
      onChange: () => {},
      file,
      now: () => now,
      versions,
    });
    await svc.refresh();
    const before = svc.state().industry.length;
    svc.opened(); // visit 1
    now += 10 * day;
    svc.opened(); // visit 2: everything from visit 1 is now 10+ days old and seen
    const cached = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      sources: Record<string, { items?: unknown[] }>;
    };
    const left = Object.values(cached.sources).reduce((n, c) => n + (c.items?.length ?? 0), 0);
    expect(before).toBeGreaterThan(0);
    expect(left).toBe(0);
    expect(svc.state().industry).toHaveLength(0);
  });

  it('runs one refresh at a time', async () => {
    const calls: Call[] = [];
    const svc = new NewsService({
      fetcher: makeFetcher(calls),
      onChange: () => {},
      file: tmpFile(),
      now: () => NOW,
      versions: async () => null,
    });
    await Promise.all([svc.refresh(), svc.refresh()]);
    expect(calls).toHaveLength(SOURCES.length);
  });
});

describe('Korea (T63)', () => {
  it('GeekNews (Atom): AI items only', () => {
    const items = parseFeed(fixture('geeknews.xml'), 'geeknews', { aiOnly: true });
    const all = parseFeed(fixture('geeknews.xml'), 'geeknews');
    expect(all.length).toBe(21); // 20 captured + the Graphify item T64 tests apply with
    expect(items.length).toBeGreaterThan(2);
    expect(items.length).toBeLessThan(all.length);
    expect(items.every((i) => i.url.startsWith('https://news.hada.io/'))).toBe(true);
    expect(items.some((i) => i.title.includes('Inkling, Qwen'))).toBe(true);
    expect(items.some((i) => i.title.includes('델타항공'))).toBe(false);
  });

  it('dates without an offset are read in the given zone', () => {
    expect(parseDate('2026-11-20 09:00:00', '+09:00')).toBe(Date.parse('2026-11-20T00:00:00Z'));
    expect(parseDate('Fri, 20 Nov 2026 02:00:00 GMT', '+09:00')).toBe(Date.parse('2026-11-20T02:00:00Z'));
  });

  it('Naver D2 (Atom, head only): AI posts kept', () => {
    const all = parseFeed(fixture('naver-d2.atom'), 'naver-d2');
    const ai = parseFeed(fixture('naver-d2.atom'), 'naver-d2', { aiOnly: true });
    expect(all.length).toBe(14);
    expect(ai.length).toBeGreaterThan(3);
    expect(ai.length).toBeLessThan(all.length);
    expect(ai.every((i) => i.url.startsWith('https://d2.naver.com/'))).toBe(true);
  });

  it('Toss: a feed cut off mid-item (head only) keeps the whole items', () => {
    const items = parseFeed(fixture('toss.xml'), 'toss');
    expect(items.length).toBeGreaterThanOrEqual(7);
    expect(items.every((i) => i.url.startsWith('https://toss.tech/'))).toBe(true);
  });

  it('company blogs: AI posts kept, others dropped', () => {
    const lycorp = parseFeed(fixture('lycorp.xml'), 'lycorp', { aiOnly: true }).map((i) => i.title);
    expect(lycorp.some((t) => t.includes('가드레일'))).toBe(true);
    expect(lycorp.some((t) => t.includes('DEF CON'))).toBe(false);
    for (const [name, id] of [
      ['kakao.xml', 'kakao'],
      ['woowahan.xml', 'woowahan'],
      ['daangn.xml', 'daangn'],
    ] as const)
      expect(parseFeed(fixture(name), id).length).toBeGreaterThan(0);
  });

  it('the AI filter reads Korean and English', () => {
    expect(AI_TOPIC.test('AI 에이전트를 위한 멀티모달 모델')).toBe(true);
    expect(AI_TOPIC.test('LLM이 만든 SQL을 믿고 실행하기까지')).toBe(true);
    expect(AI_TOPIC.test('토스뱅크가 패키지를 관리하는 방식')).toBe(false);
    expect(AI_TOPIC.test('HTML email templates')).toBe(false);
  });

  it('Korean keywords bucket items', () => {
    expect(groupsOf('Claude Code 하네스 설계')).toEqual(['harness']);
    expect(groupsOf('서브에이전트로 병렬 작업')).toEqual(['subagent']);
    expect(groupsOf('훅으로 알림 보내기')).toEqual(['hook']);
    expect(groupsOf('국내 최초 광고 MCP 출시')).toEqual(['mcp']);
    expect(groupsOf('모두의 AI 스킬로 만들기')).toEqual(['mcp']);
    expect(groupsOf('컨텍스트 엔지니어링 입문')).toEqual(['context']);
    expect(groupsOf('바이브코딩 회고')).toEqual(['vibe']);
    expect(groupsOf('에이전틱 AI 시대')).toEqual(['vibe']);
    // The fixtures: at least one Korean item lands in a group.
    const kr = [
      ...parseFeed(fixture('geeknews.xml'), 'geeknews', { aiOnly: true }),
      ...parseFeed(fixture('naver-d2.atom'), 'naver-d2', { aiOnly: true }),
      ...parseFeed(fixture('toss.xml'), 'toss', { aiOnly: true }),
      ...parseFeed(fixture('daangn.xml'), 'daangn', { aiOnly: true }),
      ...parseFeed(fixture('lycorp.xml'), 'lycorp', { aiOnly: true }),
    ];
    expect(kr.some((i) => i.groups.length > 0)).toBe(true);
  });

  it('reads only the head of a body and cancels the rest', async () => {
    const chunks = [new Uint8Array(40).fill(65), new Uint8Array(40).fill(66), new Uint8Array(40).fill(67)];
    const cancel = vi.fn(async () => {});
    let i = 0;
    const reader = {
      read: async () => (i < chunks.length ? { done: false, value: chunks[i++] } : { done: true }),
      cancel,
    };
    const text = await readHead(reader, 50);
    expect(text).toBe('A'.repeat(40) + 'B'.repeat(10));
    expect(i).toBe(2);
    expect(cancel).toHaveBeenCalled();
  });

  it('the summary prompt says items may be Korean', () => {
    expect(summaryPrompt([], 'ko')).toMatch(/Korean sources/);
  });
});
