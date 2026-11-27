import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  EditorBanner,
  EditorCompare,
  ReviewConfirm,
  ReviewCounts,
  ReviewMeta,
} from '@design-system/react';
import { api, type NoteSeenState } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { DiffView } from '@/entities/diff';
import { review, revertHunk } from '../model/review';
import { ago, seenChanged } from '../model/ago';

/** The editor's slot (`NoteSlotProps` of edit-note): the note, its text now, and a way to change it as one edit. */
export interface ReviewSlot {
  path: string;
  text: () => string;
  /** Changes when the editor's text settles. */
  version: string;
  apply: (next: string) => void;
  readOnly: boolean;
}

const fileName = (p: string) => p.split(/[/\\]/).pop() ?? p;

/**
 * T80: above the note, when it changed outside (an agent, a terminal, git) since the user last looked: who, how many
 * lines, when; Review shows the diff (seen → now) with a confirmed per-hunk revert; Mark as seen takes the note as
 * it is. Nothing is diffed unless the note differs from its seen copy.
 */
export function NoteReviewBar({ slot }: { slot: ReviewSlot }) {
  const t = useT();
  const { path } = slot;
  const [state, setState] = useState<NoteSeenState | null>(null);
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState(null);
    setOpen(false);
    setAsking(null);
    const load = () =>
      void api.noteSeenState(path).then((s) => {
        if (alive) setState(s);
      });
    load();
    // The open note's watcher (no polling): an outside write, or our own save.
    const off = api.onNoteChanged((c) => {
      if (c.path !== path) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(load, 200);
    });
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      off();
    };
  }, [path]);

  const r = useMemo(
    () => (state ? review(fileName(path), state.seenText, slot.text()) : null),
    // `slot.version` stands for "the editor's text changed".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, path, slot.version],
  );
  if (!state || !r) return null;

  const markSeen = () =>
    void api.noteSeenMark(path).then(() => {
      setState(null);
      setOpen(false);
      seenChanged();
    });

  return (
    <>
      <EditorBanner
        actions={
          <>
            <Button variant="ghost" aria-pressed={open} onClick={() => setOpen((o) => !o)}>
              {open ? t('noteReview.reviewHide') : t('noteReview.review')}
            </Button>
            <Button onClick={markSeen}>{t('noteReview.markSeen')}</Button>
          </>
        }
      >
        {state.by === 'claude' ? t('noteReview.byClaude') : t('noteReview.byOutside')}
        {' · '}
        <ReviewCounts added={r.added} removed={r.removed} unit={t('noteReview.lines')} />
        {' · '}
        <ReviewMeta>{ago(t, state.changedAt)}</ReviewMeta>
      </EditorBanner>
      {open && (
        <EditorCompare>
          <DiffView
            files={[r.file]}
            renderHunkActions={
              slot.readOnly
                ? undefined
                : (_f, i) =>
                    asking === i ? (
                      <ReviewConfirm
                        actions={
                          <>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                setAsking(null);
                                // Against the text as it is this instant (the shown diff lags edits a little);
                                // skipped if the hunks moved meanwhile — the view refreshes.
                                const now = slot.text();
                                const fresh = review(fileName(path), state.seenText, now);
                                const h = fresh?.hunks.length === r.hunks.length ? fresh.hunks[i] : undefined;
                                if (h) slot.apply(revertHunk(now, state.seenText, h));
                              }}
                            >
                              {t('noteReview.revert')}
                            </Button>
                            <Button variant="ghost" onClick={() => setAsking(null)}>
                              {t('noteReview.cancel')}
                            </Button>
                          </>
                        }
                      >
                        {t('noteReview.revertConfirm')}
                      </ReviewConfirm>
                    ) : (
                      <Button variant="ghost" onClick={() => setAsking(i)}>
                        {t('noteReview.revert')}
                      </Button>
                    )
            }
          />
        </EditorCompare>
      )}
    </>
  );
}
