import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { api } from '@/shared/api';
import { attach } from '../lib/terminalBus';

const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

interface Props {
  id: string;
  visible: boolean;
}

export default function TerminalView({ id, visible }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      fontFamily: token('--font-family-mono'),
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      macOptionIsMeta: true,
      scrollback: 10000,
      theme: {
        background: token('--color-terminal-bg'),
        foreground: token('--color-terminal-fg'),
        cursor: token('--color-terminal-cursor'),
        selectionBackground: token('--color-terminal-selection'),
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_e, url) => window.open(url)));
    term.open(host);

    // GPU rendering: less CPU/battery than the DOM renderer. Falls back to DOM if the context is lost.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* DOM renderer fallback */
    }

    termRef.current = term;
    fitRef.current = fit;

    const detach = attach(id, (data) => term.write(data));
    const input = term.onData((data) => api.write(id, data));
    const resized = term.onResize(({ cols, rows }) => api.resize(id, cols, rows));
    const ro = new ResizeObserver(() => host.offsetParent && fit.fit());
    ro.observe(host);

    return () => {
      ro.disconnect();
      input.dispose();
      resized.dispose();
      detach();
      term.dispose();
    };
  }, [id]);

  useEffect(() => {
    if (!visible) return;
    requestAnimationFrame(() => {
      fitRef.current?.fit();
      termRef.current?.focus();
    });
  }, [visible]);

  return <div ref={hostRef} className="c-pane__term" />;
}
