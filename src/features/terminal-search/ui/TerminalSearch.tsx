import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { ISearchOptions, SearchAddon as SearchAddonType } from '@xterm/addon-search';
import { TermFind, TermOverlay } from '@design-system/react';
import { useTerminal } from '@/entities/session';
import { useT } from '@/shared/i18n';
import { onThemeChange } from '@/shared/lib/theme';
import { countText, initialQuery, type FindResult } from '../model/search';
import { closeFind, useFindState } from '../model/store';

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Match highlights from the tokens (xterm decorations take opaque #RRGGBB; re-read when the theme changes). */
const decorations = (): NonNullable<ISearchOptions['decorations']> => {
  const match = token('--color-terminal-match');
  const active = token('--color-terminal-match-active');
  return {
    matchBackground: match,
    activeMatchBackground: active,
    matchOverviewRuler: match,
    activeMatchColorOverviewRuler: active,
  };
};

/** Last query, shared by every bar: ⌘F again starts where the user left off. */
let lastQuery = '';

/** The addon is loaded only while the bar is open (it keeps decorations and listeners on the terminal). */
async function loadAddon(term: Terminal): Promise<SearchAddonType> {
  const { SearchAddon } = await import('@xterm/addon-search');
  const addon = new SearchAddon();
  term.loadAddon(addon);
  return addon;
}

function FindBar({ term, sessionId, n }: { term: Terminal; sessionId: string; n: number }) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [addon, setAddon] = useState<SearchAddonType | null>(null);
  const [query, setQuery] = useState(() => initialQuery(term.getSelection(), lastQuery));
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<FindResult | null>(null);

  useEffect(() => {
    let alive = true;
    let loaded: SearchAddonType | null = null;
    let sub: { dispose(): void } | null = null;
    void loadAddon(term).then((a) => {
      if (!alive) return a.dispose();
      loaded = a;
      sub = a.onDidChangeResults((r) => setResult(r));
      setAddon(a);
    });
    return () => {
      alive = false;
      sub?.dispose();
      // The terminal may already be gone (session closed): it disposed its addons itself.
      try {
        loaded?.clearDecorations();
        loaded?.dispose();
      } catch {
        // nothing left to clear
      }
    };
  }, [term]);

  // Focus and select the query on open and on every ⌘F while open.
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [n]);

  const options = useCallback(
    (incremental: boolean): ISearchOptions => ({ caseSensitive, incremental, decorations: decorations() }),
    [caseSensitive],
  );

  // Search as the user types (incremental: the current match grows instead of jumping ahead).
  useEffect(() => {
    if (!addon) return;
    lastQuery = query;
    if (!query) {
      addon.clearDecorations();
      term.clearSelection();
      setResult(null);
      return;
    }
    addon.findNext(query, options(true));
  }, [addon, query, options, term]);

  useEffect(() => {
    if (!addon) return;
    return onThemeChange(() => {
      if (query) addon.findNext(query, options(true));
    });
  }, [addon, query, options]);

  const next = () => {
    if (addon && query) addon.findNext(query, options(false));
  };
  const prev = () => {
    if (addon && query) addon.findPrevious(query, options(false));
  };
  const close = () => {
    closeFind(sessionId);
    term.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return; // Hangul: Enter commits the syllable first
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) prev();
      else next();
    }
  };

  return (
    <TermFind
      label={t('term.find')}
      query={query}
      onQuery={setQuery}
      onKeyDown={onKeyDown}
      inputRef={inputRef}
      placeholder={t('term.find.placeholder')}
      count={query ? countText(result, t('term.find.none')) : ''}
      empty={!!query && result?.resultCount === 0}
      caseSensitive={caseSensitive}
      onToggleCase={() => {
        setCaseSensitive((c) => !c);
        inputRef.current?.focus();
      }}
      onPrev={prev}
      onNext={next}
      onClose={close}
      labels={{
        caseSensitive: t('term.find.case'),
        prev: t('term.find.prev'),
        next: t('term.find.next'),
        close: t('term.find.close'),
      }}
    />
  );
}

/** Find in a session's scrollback (T40). Rendered next to its `TerminalView`; shows the bar while it's open there. */
export default function TerminalSearch({ sessionId }: { sessionId: string }) {
  const term = useTerminal(sessionId);
  const { open, n } = useFindState();

  // The bar belongs to a mounted terminal; drop it if this one goes away while open.
  useEffect(() => () => closeFind(sessionId), [sessionId]);

  if (!term || open !== sessionId) return null;
  return (
    <TermOverlay>
      <FindBar term={term} sessionId={sessionId} n={n} />
    </TermOverlay>
  );
}
