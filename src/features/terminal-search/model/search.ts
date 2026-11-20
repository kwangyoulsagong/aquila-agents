// Pure parts of the find bar (T40).

/** What the search addon reports after a search (`resultIndex` is -1 past its highlight limit). */
export interface FindResult {
  resultIndex: number;
  resultCount: number;
}

/** Count shown in the bar: "" with no query yet, "No results", "3/17", or "1000+" past the highlight limit. */
export function countText(result: FindResult | null, none: string): string {
  if (!result) return '';
  if (result.resultCount === 0) return none;
  if (result.resultIndex < 0) return `${result.resultCount}+`;
  return `${result.resultIndex + 1}/${result.resultCount}`;
}

/** The query a bar opens with: the terminal's selection when it is a short single line, else the last query. */
export function initialQuery(selection: string, last: string): string {
  const s = selection.trim();
  if (s && !s.includes('\n') && s.length <= 200) return s;
  return last;
}
