// Knowledge graph (T65): one Markdown file → what it says about other things. Pure, no fs: runs in the index worker.
// Nothing about any repo's format is built in — any folder of `.md` (meeting notes, specs, memos) parses the same way.

export interface WikiLink {
  /** `folder/Name` or `Name`, without `.md`. */
  target: string;
  heading?: string;
  alias?: string;
}

export interface FrontmatterRef {
  key: string;
  value: string;
}

export interface ParsedNote {
  title: string;
  headings: { level: number; text: string }[];
  wikiLinks: WikiLink[];
  /** Relative links to other `.md` files (`./spec.md#api`), decoded, without the `#heading`. */
  mdLinks: string[];
  /** Without `#`, as written (first spelling wins). */
  tags: string[];
  /** Any keys. Lists stay lists; nested maps are kept as their raw text. */
  frontmatter: Record<string, string | string[]>;
  /** Scalar frontmatter values (and list items) that may name another note: `owner: Kim`, `spec: "[[Login]]"`. */
  frontmatterRefs: FrontmatterRef[];
  /** http(s) links, normalized (lowercase host, no trailing slash or `#`). */
  urls: string[];
  /** Ticket-like tokens, read whole: `DB-12`, `PROJ-104`, `FE-REQ-030` (every prefix segment kept, T79). */
  ids: string[];
  /** T79: frontmatter `id:` / `status:` when they're short scalars. */
  fmId?: string;
  status?: string;
  /** Words that look like code (`useWorkspace`, `parse_note`, `apply.ts`): matched against project code names. */
  idents: string[];
  /** Lowercased body (no frontmatter, no `[[links]]`) to find other notes' titles in. */
  text: string;
}

const FENCE = /^(\s{0,3})(`{3,}|~{3,})/;
const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const WIKI = /!?\[\[([^\]\n]+?)\]\]/g;
const MD_LINK = /\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'(][^)]*["')])?\s*\)/g;
// `#tag` after a space or line start, with at least one non-digit (`#12` is an issue number, not a tag).
const TAG = /(^|[\s(,])#([\p{L}\p{N}_/-]*[\p{L}_][\p{L}\p{N}_/-]*)/gu;
const URL_RE = /https?:\/\/[^\s<>()[\]"'`]+/g;
/**
 * An ID with its whole prefix (`DB-12`, `FE-REQ-030`; T79 — before, `FE-REQ-030` read as `REQ-030`). Same shape as
 * the renderer's `ID_RE` (features/note-ids).
 */
const ID = /\b[A-Z][A-Z0-9]+(?:-[A-Z][A-Z0-9]*)*-\d+\b/g;
const IDENT = /[A-Za-z_$][\w$]*(?:\.[A-Za-z0-9]+)?/g;
/** Prefixes that look like IDs but are versions / standards. */
const NOT_IDS = new Set([
  'UTF',
  'ISO',
  'SHA',
  'MD',
  'AES',
  'RSA',
  'HTTP',
  'TLS',
  'SSL',
  'GPT',
  'IPV',
  'ES',
  'H',
]);
const CODE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|c|cc|cpp|h|hpp|m|vue|svelte|css|scss|sql|sh|json|ya?ml|toml)$/;
const MAX_IDENTS = 2000;

/**
 * Looks like a code name, not a word: camelCase / PascalCase with a hump, snake_case, or a file name with a code
 * extension. Plain words (`index`, `Login`) never match, so prose doesn't link to every file called that.
 */
export function codeish(s: string): boolean {
  if (s.length < 4) return false;
  if (CODE_EXT.test(s)) return /[A-Za-z].*[A-Za-z0-9]/.test(s.replace(CODE_EXT, ''));
  if (/[a-z][A-Z]/.test(s) || /[A-Z]{2}[a-z]/.test(s)) return true;
  return /[A-Za-z]_[A-Za-z]/.test(s);
}

/** `https://Example.com/a/#x` → `https://example.com/a`. Trailing punctuation from prose is dropped. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.replace(/[.,;:!?*_~]+$/, '');
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

const unquote = (s: string): string => {
  const t = s.trim();
  return /^(["']).*\1$/.test(t) ? t.slice(1, -1) : t;
};

/** Just enough YAML for frontmatter: `key: value`, `key: [a, b]`, `key:` + `- item` lines. Nested maps stay raw. */
export function parseFrontmatter(src: string): { data: Record<string, string | string[]>; body: string } {
  const m = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(src);
  if (!m) return { data: {}, body: src };
  const data: Record<string, string | string[]> = {};
  let key: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      const prev = data[key];
      const list = Array.isArray(prev) ? prev : prev ? [prev] : [];
      data[key] = [...list, unquote(item[1])];
      continue;
    }
    if (/^\s/.test(line) && key) {
      // Nested map / folded text: kept raw.
      const prev = data[key];
      data[key] = `${typeof prev === 'string' ? prev : ''}${prev ? '\n' : ''}${line.trim()}`;
      continue;
    }
    const kv = /^([^:#\s][^:]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) continue;
    key = kv[1].trim();
    const value = (kv[2] ?? '').trim();
    if (/^\[.*\]$/.test(value) && !/^\[\[.*\]\]$/.test(value))
      data[key] = value.slice(1, -1).split(',').map(unquote).filter(Boolean);
    else data[key] = unquote(value);
  }
  return { data, body: src.slice(m[0].length) };
}

function wikiLink(raw: string): WikiLink | null {
  const [targetPart, alias] = raw.split('|');
  const [target, heading] = targetPart.split('#');
  const t = target.trim().replace(/\.md$/i, '');
  if (!t && !heading) return null;
  return {
    target: t,
    ...(heading?.trim() ? { heading: heading.trim() } : {}),
    ...(alias?.trim() ? { alias: alias.trim() } : {}),
  };
}

/** `[x](../spec%20a.md#api)` → `../spec a.md`; external, absolute and non-Markdown links → null. */
function mdTarget(href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#')) return null;
  const noHash = href.split('#')[0].split('?')[0];
  if (!/\.md$/i.test(noHash)) return null;
  try {
    return decodeURIComponent(noHash);
  } catch {
    return noHash;
  }
}

const tagKey = (key: string) => /^tags?$/i.test(key);

/**
 * Parses one note. `fileName` (`2026-11-20 sync.md`) is the title fallback when there's no frontmatter `title`
 * and no `# H1`.
 */
export function parseNote(fileName: string, src: string): ParsedNote {
  const { data: frontmatter, body } = parseFrontmatter(src);
  const headings: ParsedNote['headings'] = [];
  const prose: string[] = [];
  const code: string[] = [];
  let fence: string | null = null;
  for (const line of body.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[2][0] === fence[0] && f[2].length >= fence.length) fence = null;
      else code.push(line);
      continue;
    }
    if (f) {
      fence = f[2];
      continue;
    }
    const h = HEADING.exec(line);
    if (h) headings.push({ level: h[1].length, text: h[2] });
    prose.push(line);
  }
  // Inline code: no links or tags inside, but code names are.
  const inline: string[] = [];
  const proseText = prose.join('\n').replace(/`[^`\n]+`/g, (s) => {
    inline.push(s.slice(1, -1));
    return ' ';
  });

  const wikiLinks: WikiLink[] = [];
  for (const m of proseText.matchAll(WIKI)) {
    const l = wikiLink(m[1]);
    if (l) wikiLinks.push(l);
  }
  const mdLinks = new Set<string>();
  const urls = new Set<string>();
  for (const m of proseText.matchAll(MD_LINK)) {
    const t = mdTarget(m[2]);
    if (t) mdLinks.add(t);
  }
  for (const m of proseText.matchAll(URL_RE)) {
    const u = normalizeUrl(m[0]);
    if (u) urls.add(u);
  }

  const tags = new Map<string, string>();
  const addTag = (t: string) => {
    const clean = t.replace(/^#/, '').trim();
    if (clean && !tags.has(clean.toLowerCase())) tags.set(clean.toLowerCase(), clean);
  };
  for (const m of proseText.replace(WIKI, ' ').matchAll(TAG)) addTag(m[2].replace(/[/-]+$/, ''));

  const frontmatterRefs: FrontmatterRef[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    const values = Array.isArray(value) ? value : value.includes('\n') ? [] : [value];
    for (const v of values) {
      if (tagKey(key)) {
        for (const t of v.split(/[\s,]+/)) addTag(t);
        continue;
      }
      if (!v || v.length > 120) continue;
      const wiki = /^\[\[([^\]]+)\]\]$/.exec(v);
      if (wiki) {
        const l = wikiLink(wiki[1]);
        if (l) frontmatterRefs.push({ key, value: l.target });
      } else frontmatterRefs.push({ key, value: v });
      const u = /^https?:\/\//.test(v) ? normalizeUrl(v) : null;
      if (u) urls.add(u);
    }
  }

  // Frontmatter values count for IDs and code names too (`id: DB-12`, `component: SessionTabs`).
  const fmText = frontmatterRefs.map((r) => r.value).join('\n');
  const noFences = [proseText, inline.join('\n'), fmText].join('\n');
  const ids = new Set<string>();
  for (const m of noFences.matchAll(ID)) if (!NOT_IDS.has(m[0].split('-')[0]!)) ids.add(m[0]);
  const scalar = (key: string): string | undefined => {
    const k = Object.keys(frontmatter).find((x) => x.toLowerCase() === key);
    const v = k ? frontmatter[k] : undefined;
    return typeof v === 'string' && v && v.length <= 80 && !v.includes('\n') ? v.trim() : undefined;
  };
  const fmId = scalar('id');
  const status = scalar('status');

  const idents = new Set<string>();
  for (const part of [noFences, code.join('\n')])
    for (const m of part.matchAll(IDENT)) {
      if (idents.size >= MAX_IDENTS) break;
      if (codeish(m[0])) idents.add(m[0]);
    }

  const fmTitle = typeof frontmatter.title === 'string' ? frontmatter.title.trim() : '';
  const h1 = headings.find((h) => h.level === 1)?.text;
  const title = fmTitle || h1 || fileName.replace(/\.md$/i, '');

  return {
    title,
    headings,
    wikiLinks,
    mdLinks: [...mdLinks],
    tags: [...tags.values()],
    frontmatter,
    frontmatterRefs,
    urls: [...urls],
    ids: [...ids],
    ...(fmId ? { fmId } : {}),
    ...(status ? { status } : {}),
    idents: [...idents],
    text: body.replace(WIKI, ' ').toLowerCase(),
  };
}
