import { useCallback, useEffect, useState } from 'react';
import { api, type Language, type NewsState } from '@/shared/api';

export interface Trends {
  state: NewsState | null;
  refresh: () => void;
  /** The modal opened: marks everything seen; main fetches if its cache is older than 30 min. */
  opened: () => void;
  open: (url: string) => void;
  /** Resolves with an error message, or null when it worked. */
  summarize: (language: Language, account?: string) => Promise<string | null>;
}

/** News state from main: the cache on mount, then pushed when a fetch (on open / ↻) or a summary finishes. */
export function useTrends(): Trends {
  const [state, setState] = useState<NewsState | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .news()
      .then((s) => alive && setState(s))
      .catch(() => {});
    const off = api.onNews(setState);
    return () => {
      alive = false;
      off();
    };
  }, []);
  const refresh = useCallback(() => void api.newsRefresh().catch(() => {}), []);
  const opened = useCallback(() => api.newsOpened(), []);
  const open = useCallback((url: string) => api.newsOpen(url), []);
  const summarize = useCallback(
    (language: Language, account?: string) =>
      api.newsSummarize(language, account).then(
        () => null,
        // Electron prefixes rejected handler errors: keep the message only.
        (err: unknown) =>
          String(err instanceof Error ? err.message : err).replace(
            /^Error invoking remote method '[^']+': (Error: )?/,
            '',
          ),
      ),
    [],
  );
  return { state, refresh, opened, open, summarize };
}
