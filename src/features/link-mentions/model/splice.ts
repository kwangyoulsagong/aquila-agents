// "Link" on an unlinked mention (T79): the first plain mention of a note's title in another note becomes a
// `[[link]]`. A splice of only those characters — the rest of the file (line endings, BOM, spacing) is untouched.
// Matches the index's mention rule (graph/build.ts `contains`): case-insensitive, ASCII titles as whole words only.

// eslint-disable-next-line no-control-regex -- the whole ASCII range on purpose
const ASCII = /^[\x00-\x7f]*$/;
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}_]/u.test(c);

/** Spans of a line that aren't prose: inline code, `[[links]]`, Markdown links / images, bare URLs. */
function maskedSpans(line: string): [number, number][] {
  const out: [number, number][] = [];
  for (const re of [/(`+)[^`]*?\1/g, /!?\[\[[^\]\n]*\]\]/g, /!?\[[^\]\n]*\]\([^)\n]*\)/g, /https?:\/\/\S+/g])
    for (const m of line.matchAll(re)) out.push([m.index, m.index + m[0].length]);
  return out;
}

export interface Splice {
  /** The whole new text. */
  text: string;
  /** Where the replaced mention was, in the old text. */
  from: number;
  to: number;
  insert: string;
}

/**
 * The text with the first plain mention of `title` turned into `[[name]]` (or `[[name|as written]]` when the file
 * name differs from the words), or null when there's none outside frontmatter, code and existing links.
 */
export function linkFirstMention(text: string, title: string, name: string): Splice | null {
  const want = title.trim().toLowerCase();
  if (!want || !name.trim()) return null;
  const ascii = ASCII.test(want);
  const lines = /\r\n|\n|\r/g;
  let start = 0;
  let fence: string | null = null;
  let inFrontmatter = false;
  let first = true;
  while (start <= text.length) {
    const br = lines.exec(text);
    const end = br ? br.index : text.length;
    const line = text.slice(start, end);
    const lineStart = start;
    start = br ? br.index + br[0].length : text.length + 1;

    if (first) {
      first = false;
      if (/^\uFEFF?---[ \t]*$/.test(line)) {
        inFrontmatter = true;
        continue;
      }
    }
    if (inFrontmatter) {
      if (/^(---|\.\.\.)[ \t]*$/.test(line)) inFrontmatter = false;
      continue;
    }
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]!;
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;

    const lower = line.toLowerCase();
    // Lowercasing changed the length (rare letters): offsets wouldn't line up, so skip the line.
    if (lower.length !== line.length) continue;
    const masked = maskedSpans(line);
    let i = lower.indexOf(want);
    while (i >= 0) {
      const j = i + want.length;
      const free = !masked.some(([a, b]) => i < b && j > a);
      const whole = !ascii || (!isWordChar(line[i - 1]) && !isWordChar(line[j]));
      if (free && whole) {
        const said = line.slice(i, j);
        const insert =
          said.toLowerCase() === name.trim().toLowerCase() ? `[[${said}]]` : `[[${name.trim()}|${said}]]`;
        const from = lineStart + i;
        const to = lineStart + j;
        return { text: text.slice(0, from) + insert + text.slice(to), from, to, insert };
      }
      i = lower.indexOf(want, i + 1);
    }
    if (!br) break;
  }
  return null;
}

/** What goes between `[[` and `]]` for a note: its file name, which the index resolves first. */
export const linkName = (path: string) => (path.split(/[/\\]/).pop() ?? path).replace(/\.md$/i, '');
