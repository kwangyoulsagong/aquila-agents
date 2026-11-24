import { useEffect, useState } from 'react';

/**
 * True while any native <dialog> is open. Native views (the preview, extensions) draw above the page and would
 * cover it, so they hide meanwhile.
 */
export function useDialogOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector('dialog[open]'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    return () => mo.disconnect();
  }, []);
  return open;
}
