import { useEffect, useRef, useState, type RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import { Dropzone, TermHint, TermJump, TermNote, TermOverlay } from '@design-system/react';
import { safePaste, useTerminal } from '@/entities/session';
import { api, type SessionKind } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { SESSION_DRAG_TYPE } from '@/shared/lib/sessionDrag';
import { accelerator } from '@/shared/lib/shortcuts';
import { screenTargets } from '../lib/screen';
import { pathsInput } from '../model/paths';
import { assignLabels, extendLabels, resolveLabel } from '../model/quickSelect';
import {
  clearFlash,
  closeQuickSelect,
  copyLastReply,
  flash,
  toggleQuickSelect,
  useHelpersState,
  type FlashKey,
} from '../model/store';

const FLASH_MS = 1600;

interface Props {
  sessionId: string;
  kind: SessionKind;
}

/** Whether the user has scrolled up (xterm then holds the view still) and whether output arrived since. */
function useFollow(term: Terminal | null) {
  const [state, setState] = useState({ scrolled: false, unread: false });
  useEffect(() => {
    if (!term) return;
    let scrolled = false;
    let unread = false;
    // What React has: setState only when it changes. xterm fires onScroll per line fed, so a flood (`yes`) would
    // queue hundreds of thousands of updates a second — measured ~500 MB of live heap and dropped frames.
    let shown = { scrolled, unread };
    const push = () => {
      if (shown.scrolled === scrolled && shown.unread === unread) return;
      shown = { scrolled, unread };
      setState(shown);
    };
    const sync = () => {
      const b = term.buffer.active;
      scrolled = b.viewportY < b.baseY;
      if (!scrolled) unread = false;
      push();
    };
    const written = () => {
      sync();
      if (scrolled && !unread) {
        unread = true;
        push();
      }
    };
    const subs = [
      term.onScroll(sync),
      term.buffer.onBufferChange(sync),
      term.onResize(sync),
      term.onWriteParsed(written),
    ];
    sync();
    return () => {
      for (const s of subs) s.dispose();
      setState({ scrolled: false, unread: false });
    };
  }, [term]);
  return state;
}

/** Paths typed into the session (shell-quoted, space after), like Terminal.app drag and drop. False when none. */
function typePaths(term: Terminal, paths: string[]): boolean {
  const input = pathsInput(paths);
  if (!input) return false;
  safePaste(term, input);
  term.focus();
  return true;
}

/** Right-click Paste: files or an image as paths, like ⌘V; otherwise the text, through the same safe paste. */
async function pasteClipboard(term: Terminal): Promise<void> {
  const paths = await api.clipboardPaths().catch(() => [] as string[]);
  if (typePaths(term, paths)) return;
  const text = await api.clipboardText().catch(() => '');
  if (text) safePaste(term, text);
}

const hasFiles = (dt: DataTransfer | null) =>
  !!dt && dt.types.includes('Files') && !dt.types.includes(SESSION_DRAG_TYPE);

/** ⌘V with files or an image on the clipboard, and files dropped on the terminal → their paths, typed in. */
function useFileInput(term: Terminal | null, sessionId: string) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = term?.element;
    if (!term || !el) return;
    const type = (paths: string[]) => typePaths(term, paths);
    // Capture on xterm's root runs before xterm's own paste handler on its textarea.
    const onPaste = (e: ClipboardEvent) => {
      if (!hasFiles(e.clipboardData)) return;
      const text = e.clipboardData?.getData('text/plain') ?? '';
      e.preventDefault();
      e.stopPropagation();
      void api
        .clipboardPaths()
        .catch(() => [] as string[])
        .then((paths) => {
          if (!type(paths) && text) safePaste(term, text);
        });
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setOver(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (!(e.relatedTarget instanceof Node && el.contains(e.relatedTarget))) setOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      setOver(false);
      type([...(e.dataTransfer?.files ?? [])].map((f) => api.pathForFile(f)));
    };
    el.addEventListener('paste', onPaste, true);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('paste', onPaste, true);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
      setOver(false);
    };
  }, [term, sessionId]);
  return over;
}

/** Right-click on the terminal: copy the selection, paste, the helpers, jump to bottom. */
function useContextMenu(term: Terminal | null, sessionId: string, kind: SessionKind, scrolled: boolean) {
  const t = useT();
  const scrolledRef = useRef(scrolled);
  scrolledRef.current = scrolled;
  useEffect(() => {
    const el = term?.element;
    if (!term || !el) return;
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      const selection = term.getSelection();
      void api
        .showContextMenu([
          {
            id: 'copy',
            label: t('term.copySelection'),
            enabled: !!selection,
            accelerator: 'CommandOrControl+C',
          },
          { id: 'paste', label: t('term.paste'), accelerator: 'CommandOrControl+V' },
          { separator: true },
          ...(kind === 'shell'
            ? []
            : [
                {
                  id: 'copyLastReply',
                  label: t('term.copyLastReply'),
                  accelerator: accelerator('copyLastReply'),
                },
              ]),
          { id: 'quickSelect', label: t('term.quickSelect'), accelerator: accelerator('quickSelect') },
          { id: 'jumpBottom', label: t('term.jumpBottom'), enabled: scrolledRef.current },
        ])
        .then((id) => {
          if (id === 'copy') {
            api.copyText(selection);
            flash(sessionId, 'copied');
          } else if (id === 'paste') void pasteClipboard(term);
          else if (id === 'copyLastReply') void copyLastReply(sessionId);
          else if (id === 'quickSelect') toggleQuickSelect(sessionId);
          else if (id === 'jumpBottom') term.scrollToBottom();
          if (id) term.focus();
        });
    };
    el.addEventListener('contextmenu', onMenu);
    return () => el.removeEventListener('contextmenu', onMenu);
  }, [term, sessionId, kind, t]);
}

/** Labels over the URLs, paths and hashes on screen; typing one copies it (⇧ types it into the session). */
function QuickSelect({
  term,
  sessionId,
  overlayRef,
}: {
  term: Terminal;
  sessionId: string;
  overlayRef: RefObject<HTMLDivElement | null>;
}) {
  const t = useT();
  const [typed, setTyped] = useState('');
  // Labelled once when opened; output that keeps coming moves the boxes, but a text keeps its label (extendLabels).
  const [{ targets, labels }, setShown] = useState(() => {
    const first = screenTargets(term.buffer.active, term.rows, term.cols);
    return { targets: first, labels: assignLabels(first) };
  });
  const [openedEmpty] = useState(() => targets.length === 0);
  useEffect(() => {
    // A short timer, not requestAnimationFrame: streaming output re-reads at most ~20×/s either way.
    let timer = 0;
    const reread = () => {
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = 0;
        const next = screenTargets(term.buffer.active, term.rows, term.cols);
        setShown((prev) => ({ targets: next, labels: extendLabels(prev.labels, next) }));
      }, 50);
    };
    const subs = [term.onWriteParsed(reread), term.onScroll(reread)];
    return () => {
      clearTimeout(timer);
      for (const s of subs) s.dispose();
    };
  }, [term]);
  const [grid] = useState(() => {
    const screen = term.element?.querySelector('.xterm-screen');
    const overlay = overlayRef.current;
    if (!screen || !overlay) return null;
    const s = screen.getBoundingClientRect();
    const o = overlay.getBoundingClientRect();
    return {
      left: s.left - o.left,
      top: s.top - o.top,
      cellW: s.width / term.cols,
      cellH: s.height / term.rows,
    };
  });

  useEffect(() => {
    if (!openedEmpty && grid) return;
    flash(sessionId, 'noTargets');
    closeQuickSelect();
  }, [openedEmpty, grid, sessionId]);

  useEffect(() => {
    term.blur(); // keys come to us, and the IME doesn't compose them
    const resized = term.onResize(() => closeQuickSelect());
    return () => {
      resized.dispose();
      term.focus();
    };
  }, [term]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // app shortcuts still work (⌘⇧E closes)
      e.preventDefault();
      e.stopPropagation();
      if (e.code === 'Escape') return closeQuickSelect();
      if (e.code === 'Backspace') return setTyped((s) => s.slice(0, -1));
      const letter = /^Key([A-Z])$/.exec(e.code)?.[1]; // by code, so it works with the Korean input source on
      if (!letter) return;
      const next = typed + letter.toLowerCase();
      const r = resolveLabel(next, labels.values());
      if (r === 'none') return;
      if (r === 'partial') return setTyped(next);
      const text = [...labels].find(([, l]) => l === r)?.[0];
      closeQuickSelect();
      if (!text) return;
      if (e.shiftKey) {
        safePaste(term, text);
        flash(sessionId, 'pasted');
      } else {
        api.copyText(text);
        flash(sessionId, 'copied');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [typed, labels, term, sessionId]);

  if (!grid) return null;
  return (
    <>
      {targets.flatMap((target, i) => {
        const label = labels.get(target.text);
        if (!label || !label.startsWith(typed)) return [];
        return target.segments.map((seg, j) => (
          <TermHint
            key={`${i}-${j}`}
            box={{
              left: grid.left + seg.col * grid.cellW,
              top: grid.top + seg.row * grid.cellH,
              width: seg.cells * grid.cellW,
              height: grid.cellH,
            }}
            label={j === 0 ? label : undefined}
            typed={!!typed}
          />
        ));
      })}
      <TermNote bar>{t('term.pick.hint')}</TermNote>
    </>
  );
}

function Flash({ n, flashKey }: { n: number; flashKey: FlashKey }) {
  const t = useT();
  useEffect(() => {
    const timer = window.setTimeout(() => clearFlash(n), FLASH_MS);
    return () => clearTimeout(timer);
  }, [n]);
  return <TermNote key={n}>{t(`term.flash.${flashKey}`)}</TermNote>;
}

/** Helpers over one session's terminal (T28). Rendered next to its `TerminalView`. */
export default function TerminalHelpers({ sessionId, kind }: Props) {
  const t = useT();
  const term = useTerminal(sessionId);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { picking, flash: note } = useHelpersState();
  const follow = useFollow(term);
  const over = useFileInput(term, sessionId);
  useContextMenu(term, sessionId, kind, follow.scrolled);

  // Quick select belongs to a mounted terminal; drop it if this one goes away while open.
  useEffect(() => () => closeQuickSelect(sessionId), [sessionId]);

  return (
    <TermOverlay ref={overlayRef}>
      {over && <Dropzone over>{t('term.drop')}</Dropzone>}
      {term && picking === sessionId && (
        <QuickSelect term={term} sessionId={sessionId} overlayRef={overlayRef} />
      )}
      {term && follow.scrolled && picking !== sessionId && (
        <TermJump
          onClick={() => {
            term.scrollToBottom();
            term.focus();
          }}
        >
          ↓ {follow.unread ? t('term.newOutput') : t('term.jumpBottom')}
        </TermJump>
      )}
      {note?.sessionId === sessionId && <Flash key={note.n} n={note.n} flashKey={note.key} />}
    </TermOverlay>
  );
}
