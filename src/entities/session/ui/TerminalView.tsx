import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { api, type SessionKind } from '@/shared/api';
import { gpuPool } from '../lib/gpuPool';
import { createImeGuard } from '../lib/imeGuard';
import { attach } from '../lib/terminalBus';
import { SCROLLBACK, sizeChanged } from '../model/terminal';

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** After this many lost WebGL contexts a terminal stays on the DOM renderer. */
const MAX_CONTEXT_LOSSES = 3;

interface Props {
  id: string;
  kind: SessionKind;
  visible: boolean;
  /** Takes keyboard focus when visible. Defaults to `visible`; split view passes it for the focused pane only. */
  focused?: boolean;
}

interface Handle {
  term: Terminal;
  /** Refit on the next frame; repeated calls in one frame collapse into one. */
  scheduleFit: () => void;
  /** WebGL renderer on / off (DOM renderer). Driven by `gpuPool`: on screen always on, hidden ones up to a cap. */
  setGpu: (on: boolean) => void;
}

export default function TerminalView({ id, kind, visible, focused = visible }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<Handle | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      fontFamily: token('--font-family-mono'),
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
      scrollback: SCROLLBACK[kind],
      theme: {
        background: token('--color-terminal-bg'),
        foreground: token('--color-terminal-fg'),
        cursor: token('--color-terminal-cursor'),
        selectionBackground: token('--color-terminal-selection'),
        scrollbarSliderBackground: token('--color-terminal-scrollbar'),
        scrollbarSliderHoverBackground: token('--color-terminal-scrollbar-hover'),
        scrollbarSliderActiveBackground: token('--color-terminal-scrollbar-hover'),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, url) => window.open(url)));
    term.open(host);

    let frame = 0;
    const scheduleFit = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        // Hidden hosts measure 0×0; pty resize only when cols/rows really change.
        if (host.offsetParent && sizeChanged(term, fit.proposeDimensions())) fit.fit();
      });
    };

    let webgl: WebglAddon | null = null;
    let losses = 0;
    const repaint = () => term.refresh(0, term.rows - 1);
    const setGpu = (on: boolean) => {
      if (on && !webgl && losses < MAX_CONTEXT_LOSSES) {
        try {
          const addon = new WebglAddon();
          addon.onContextLoss(() => {
            losses++;
            addon.dispose();
            if (webgl === addon) webgl = null;
            gpuPool.remove(handle);
            repaint(); // back on the DOM renderer
          });
          term.loadAddon(addon);
          webgl = addon;
        } catch {
          losses = MAX_CONTEXT_LOSSES; // no WebGL here: DOM renderer for good
        }
        repaint();
      } else if (!on && webgl) {
        webgl.dispose();
        webgl = null;
        repaint();
      }
    };
    const handle: Handle = { term, scheduleFit, setGpu };
    handleRef.current = handle;

    const detach = attach(id, (data, done) => term.write(data, done));
    const input = term.onData((data) => api.write(id, data));
    // Hangul IME: keys the IME swallows while composing (Enter, Esc, Ctrl+C…) still reach the session, once.
    const ime = createImeGuard({ write: (data) => api.write(id, data) });
    term.attachCustomKeyEventHandler(ime.onKey);
    // Added after xterm's own listener, so xterm sends the committed syllable first.
    term.textarea?.addEventListener('compositionend', ime.onCompositionEnd);
    const resized = term.onResize(({ cols, rows }) => api.resize(id, cols, rows));
    // Scrollbar only when there is something to scroll (CSS hides it otherwise).
    const syncScrollable = () =>
      host.toggleAttribute('data-scrollable', term.buffer.active.length > term.rows);
    const scrollable = [
      term.onWriteParsed(syncScrollable),
      term.buffer.onBufferChange(syncScrollable),
      term.onResize(syncScrollable),
    ];
    const ro = new ResizeObserver(scheduleFit);
    ro.observe(host);
    // The webfont can finish loading after the first fit; cell size changes but the host doesn't.
    document.fonts.addEventListener('loadingdone', scheduleFit);

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      document.fonts.removeEventListener('loadingdone', scheduleFit);
      input.dispose();
      term.textarea?.removeEventListener('compositionend', ime.onCompositionEnd);
      ime.dispose();
      resized.dispose();
      for (const d of scrollable) d.dispose();
      detach();
      handleRef.current = null;
      gpuPool.remove(handle);
      term.dispose();
    };
    // `kind` never changes for a session id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const h = handleRef.current;
    if (!h) return;
    api.setVisible(id, visible);
    gpuPool.show(h, visible);
    if (!visible) return;
    h.scheduleFit();
    if (focused) requestAnimationFrame(() => h.term.focus());
  }, [id, visible, focused]);

  return <div ref={hostRef} className="c-pane__term" />;
}
