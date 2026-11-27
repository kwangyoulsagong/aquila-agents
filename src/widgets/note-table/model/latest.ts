/**
 * Replies in flight for a changing key (the selected source): only the newest request's reply for the current key
 * is applied, so a slow reply for the previous source never replaces the new one's rows.
 */
export function createLatest<K>(initial: K) {
  let key = initial;
  let seq = 0;
  return {
    /** The key changed: every reply in flight is stale now. */
    select(next: K): void {
      key = next;
      seq++;
    },
    /** A request for `k` starts; the returned check says whether its reply may still be applied. */
    start(k: K): () => boolean {
      const n = ++seq;
      return () => n === seq && key === k;
    },
  };
}
