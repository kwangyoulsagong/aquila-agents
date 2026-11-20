import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/shared/api';

/**
 * Guide state: open/closed (? button, ⌘/, palette) and the one-time "Take a tour / Skip" offer that follows the
 * first-run checklist. The offer is never shown twice (~/.aquila/guide.json), nor after the guide was opened once.
 */
export function useGuide() {
  const [open, setOpen] = useState(false);
  /** Item to select on open ("How to use" in release notes); undefined = the first. */
  const [focusId, setFocusId] = useState<string | undefined>();
  const [offer, setOffer] = useState(false);
  /** null until main answered. */
  const offered = useRef<boolean | null>(null);

  useEffect(() => {
    api
      .guideState()
      .then((s) => {
        offered.current = offered.current || s.offered;
      })
      .catch(() => {});
  }, []);

  const markOffered = useCallback(() => {
    if (offered.current === true) return;
    offered.current = true;
    void api.markGuideOffered();
  }, []);

  const show = useCallback(
    (id?: unknown) => {
      // Also wired straight to onClick handlers: anything but a string id means "the first item".
      setFocusId(typeof id === 'string' ? id : undefined);
      setOffer(false);
      setOpen(true);
      markOffered();
    },
    [markOffered],
  );

  const toggle = useCallback(() => {
    setFocusId(undefined);
    setOpen((o) => !o);
    setOffer(false);
    markOffered();
  }, [markOffered]);

  const close = useCallback(() => setOpen(false), []);

  /** Call when the first-run checklist closes: offers the tour if it never was. */
  const offerOnce = useCallback(() => {
    if (offered.current !== false) return;
    setOffer(true);
    markOffered();
  }, [markOffered]);

  const dismissOffer = useCallback(() => setOffer(false), []);

  return { open, focusId, offer, show, toggle, close, offerOnce, dismissOffer };
}

export type Guide = ReturnType<typeof useGuide>;
