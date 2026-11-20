// Release notes (T27): one `release-notes/<version>.json` per version, bundled with the app (offline).
// No imports on purpose: `scripts/release-notes.ts` runs this file directly with Node's type stripping.

export type NotesLanguage = 'ko' | 'en';

/** One headline of a version: a guide item it explains ("How to use") and the media to show (default: that item's). */
export interface ReleaseHeadline {
  /** Guide item id (src/features/guide/model/registry.ts): "How to use" opens it. */
  guideId: string;
  /** Guide media id to show; defaults to `guideId`. */
  media?: string;
  title: Record<NotesLanguage, string>;
  body: Record<NotesLanguage, string>;
}

export interface ReleaseNotes {
  version: string;
  /** YYYY-MM-DD. */
  date: string;
  headlines: ReleaseHeadline[];
}

export const MIN_HEADLINES = 3;
export const MAX_HEADLINES = 5;
/** What `draft` writes where a human still has to write: `check` fails while any is left. */
export const TODO = 'TODO';

const VERSION = /^\d+\.\d+\.\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Numeric x.y.z compare (anything after `-` or `+` is ignored): <0, 0, >0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .split(/[-+]/)[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function text(v: unknown, where: string, errors: string[]): Record<NotesLanguage, string> {
  const out = { ko: '', en: '' };
  if (!isObject(v)) {
    errors.push(`${where}: expected { "ko": "…", "en": "…" }`);
    return out;
  }
  for (const lang of ['ko', 'en'] as const) {
    const s = v[lang];
    if (typeof s !== 'string' || !s.trim()) errors.push(`${where}.${lang} is missing`);
    else if (s.includes(TODO)) errors.push(`${where}.${lang} still says ${TODO}`);
    else out[lang] = s.trim();
  }
  return out;
}

/**
 * Checks one notes file. `expected` = the version its file name says. Errors are human-readable lines; the notes are
 * returned only when there are none.
 */
export function parseNotes(raw: unknown, expected?: string): { notes?: ReleaseNotes; errors: string[] } {
  const errors: string[] = [];
  if (!isObject(raw)) return { errors: ['not a JSON object'] };
  const version = typeof raw.version === 'string' ? raw.version : '';
  if (!VERSION.test(version)) errors.push('version must be x.y.z');
  else if (expected && version !== expected)
    errors.push(`version ${version} doesn't match the file name (${expected})`);
  const date = typeof raw.date === 'string' ? raw.date : '';
  if (!DATE.test(date)) errors.push('date must be YYYY-MM-DD');
  const list = Array.isArray(raw.headlines) ? raw.headlines : [];
  if (list.length < MIN_HEADLINES || list.length > MAX_HEADLINES)
    errors.push(`${list.length} headlines, expected ${MIN_HEADLINES}–${MAX_HEADLINES}`);
  const headlines = list.map((h: unknown, i): ReleaseHeadline => {
    const where = `headlines[${i}]`;
    if (!isObject(h)) {
      errors.push(`${where}: not an object`);
      return { guideId: '', title: { ko: '', en: '' }, body: { ko: '', en: '' } };
    }
    const guideId = typeof h.guideId === 'string' ? h.guideId.trim() : '';
    if (!guideId || guideId === TODO) errors.push(`${where}.guideId is missing`);
    const media = typeof h.media === 'string' && h.media.trim() ? h.media.trim() : undefined;
    return {
      guideId,
      ...(media ? { media } : {}),
      title: text(h.title, `${where}.title`, errors),
      body: text(h.body, `${where}.body`, errors),
    };
  });
  return errors.length ? { errors } : { notes: { version, date, headlines }, errors };
}

/** Bundled file path → version (`…/release-notes/0.2.0.json` → `0.2.0`). */
export const versionOfFile = (file: string): string => (file.split('/').pop() ?? '').replace(/\.json$/, '');

/** Newest first. */
export const sortNotes = (all: readonly ReleaseNotes[]): ReleaseNotes[] =>
  [...all].sort((a, b) => compareVersions(b.version, a.version));

/**
 * Versions to show after an update: newer than `lastSeen`, up to `current`, newest first — skipped versions come
 * together. `lastSeen` null = an earlier install without a record: only the current version's notes.
 */
export function unseenNotes(
  all: readonly ReleaseNotes[],
  lastSeen: string | null,
  current: string,
): ReleaseNotes[] {
  return sortNotes(all).filter(
    (n) =>
      compareVersions(n.version, current) <= 0 &&
      (lastSeen === null
        ? compareVersions(n.version, current) === 0
        : compareVersions(n.version, lastSeen) > 0),
  );
}

/** A Conventional Commit subject (`feat(split): add zoom`) → its parts; null when it isn't one. */
export function parseCommit(subject: string): { type: string; scope?: string; text: string } | null {
  const m = /^(\w+)(?:\(([^)]+)\))?!?: (.+)$/.exec(subject.trim());
  if (!m) return null;
  return { type: m[1], ...(m[2] ? { scope: m[2] } : {}), text: m[3].trim() };
}

/**
 * Draft of a version's notes from the commit subjects since the last tag: one headline per `feat` (first five, newest
 * first), English title from the subject, everything else TODO — `check` fails until a human wrote it.
 */
export function draftNotes(subjects: readonly string[], version: string, date: string): ReleaseNotes {
  const feats = subjects
    .map(parseCommit)
    .filter((c): c is NonNullable<typeof c> => !!c && c.type === 'feat')
    .slice(0, MAX_HEADLINES);
  const headlines = feats.map(
    (c): ReleaseHeadline => ({
      guideId: TODO,
      title: { ko: TODO, en: c.text.charAt(0).toUpperCase() + c.text.slice(1) },
      body: { ko: TODO, en: TODO },
    }),
  );
  while (headlines.length < MIN_HEADLINES)
    headlines.push({ guideId: TODO, title: { ko: TODO, en: TODO }, body: { ko: TODO, en: TODO } });
  return { version, date, headlines };
}
