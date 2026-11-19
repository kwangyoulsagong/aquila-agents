import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/shared/api';

/**
 * Guide state: open/closed (? button, ⌘/, palette) and the one-time "Take a tour / Skip" offer that follows the
 * first-run checklist. The offer is never shown twice (~/.aquila/guide.json), nor after the guide was opened once.
 */
export function useGuide() {
  const [open, setOpen] = useState(false);
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

  const show = useCallback(() => {
    setOffer(false);
    setOpen(true);
    markOffered();
  }, [markOffered]);

  const toggle = useCallback(() => {
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

  return { open, offer, show, toggle, close, offerOnce, dismissOffer };
}

export type Guide = ReturnType<typeof useGuide>;
