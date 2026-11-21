import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { api } from '@/shared/api';
import { onThemeChange } from '@/shared/lib/theme';
import { minimumContrast, terminalTheme, token } from '@/entities/session';

/**
 * Read-only log of one run (T60): what it printed so far, then live. Remounted per start (`key`), so a restart
 * begins on a clean screen.
 */
export default function RunLog({ id, label }: { id: string; label: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      fontFamily: token('--font-family-mono'),
      fontSize: 12,
      lineHeight: 1.2,
      disableStdin: true,
      convertEol: true, // a pipe, not a pty: bare \n
      cursorInactiveStyle: 'none',
      cursorStyle: 'bar',
      scrollback: 5000,
      theme: terminalTheme(),
      minimumContrastRatio: minimumContrast(),
    });
    const unTheme = onThemeChange(() => {
      term.options.theme = terminalTheme();
      term.options.minimumContrastRatio = minimumContrast();
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, url) => window.open(url)));
    term.open(host);
    term.textarea?.setAttribute('aria-label', label);
    let frame = 0;
    const refit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => host.offsetParent && fit.fit());
    };
    refit();
    const ro = new ResizeObserver(refit);
    ro.observe(host);
    // Chunks that arrive before the stored log are already in it (same IPC pipe, in order): dropped.
    let loaded = false;
    const off = api.onRunData((d) => {
      if (d.id === id && loaded) term.write(d.data);
    });
    let live = true;
    void api.runLog(id).then((text) => {
      if (!live) return;
      loaded = true;
      if (text) term.write(text);
    });
    return () => {
      live = false;
      off();
      ro.disconnect();
      cancelAnimationFrame(frame);
      unTheme();
      term.dispose();
    };
  }, [id, label]);
  return <div className="c-run__log" ref={hostRef} />;
}
