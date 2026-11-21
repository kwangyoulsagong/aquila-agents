import { useEffect, useRef, useState } from 'react';
import { Button, TermChipGroup, TermChips, TermOverlay } from '@design-system/react';
import { safePaste, useTerminal } from '@/entities/session';
import { useT } from '@/shared/i18n';
import { SESSION_DRAG_TYPE } from '@/shared/lib/sessionDrag';
import {
  EMPTY_LINE,
  chipPrompt,
  chipsFor,
  droppedFigmaLink,
  feedLine,
  parseFigmaLink,
  type ChipGroup,
  type FigmaLink,
} from '../model/link';

const GROUPS: readonly ChipGroup[] = ['design', 'build'];
/** A typed link is offered once typing pauses (not while the file key is still growing). */
const TYPED_SETTLE_MS = 400;

/**
 * Over a Claude/Codex terminal of a Figma-enabled project (T34, T55): a Figma link that is pasted, typed or dropped
 * offers prompt chips. A chip types a short intent sentence after the link (no Enter; the tool-level detail is in its
 * tooltip). The chips stay until one is used, × is clicked, or a line without the link is sent (the user moved on).
 * An empty Enter keeps them; once the link line was sent, a chip types the link again in front of its prompt.
 */
export default function FigmaChips({ sessionId, kind }: { sessionId: string; kind: 'claude' | 'codex' }) {
  const t = useT();
  const term = useTerminal(sessionId);
  const [link, setLink] = useState<FigmaLink | null>(null);
  /** The link is on the current input line (not sent yet). */
  const onLine = useRef(false);
  const linkRef = useRef<FigmaLink | null>(null);
  linkRef.current = link;

  useEffect(() => {
    const el = term?.element;
    if (!term || !el) return;
    let line = EMPTY_LINE;
    let settle: ReturnType<typeof setTimeout> | undefined;
    /** Offered (or used / closed) on this line: typing on doesn't bring it back. */
    let offered: string | null = null;
    const offer = (found: FigmaLink) => {
      offered = found.url;
      onLine.current = true;
      setLink(found);
    };
    // Capture, and never preventDefault: xterm still pastes the link itself.
    const onPaste = (e: ClipboardEvent) => {
      const found = parseFigmaLink(e.clipboardData?.getData('text/plain') ?? '');
      if (found) offer(found);
    };
    const typed = term.onData((data) => {
      const r = feedLine(line, data);
      line = r.line;
      if (r.sent.length) offered = null;
      for (const sentLine of r.sent) {
        const current = linkRef.current;
        if (!current) continue;
        if (sentLine.includes(current.url)) onLine.current = false;
        else if (sentLine.trim()) setLink(null);
      }
      clearTimeout(settle);
      const found = parseFigmaLink(line.text);
      if (found && found.url !== offered && found.url !== linkRef.current?.url)
        settle = setTimeout(() => offer(found), TYPED_SETTLE_MS);
    });
    // A link dragged in from the browser or Figma: pasted like ⌘V, then offered.
    const linkDrag = (e: DragEvent) => {
      const types = e.dataTransfer?.types ?? [];
      return (
        !types.includes('Files') &&
        !types.includes(SESSION_DRAG_TYPE) &&
        types.some((x) => x.startsWith('text/'))
      );
    };
    const onDragOver = (e: DragEvent) => {
      if (!linkDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onDrop = (e: DragEvent) => {
      if (!linkDrag(e) || !e.dataTransfer) return;
      const found = droppedFigmaLink(e.dataTransfer);
      if (!found) return;
      e.preventDefault();
      safePaste(term, found.url);
      term.focus();
      offer(found);
    };
    el.addEventListener('paste', onPaste, true);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('paste', onPaste, true);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('drop', onDrop);
      typed.dispose();
      clearTimeout(settle);
      setLink(null);
    };
  }, [term]);

  if (!term || !link) return null;
  const chips = chipsFor(link);
  return (
    <TermOverlay>
      <TermChips
        label={t('figma.chips')}
        closeLabel={t('figma.chips.close')}
        onClose={() => {
          setLink(null);
          term.focus();
        }}
      >
        {GROUPS.map((group) => {
          const inGroup = chips.filter((c) => c.group === group);
          if (!inGroup.length) return null;
          return (
            <TermChipGroup key={group} label={t(`figma.chips.${group}`)}>
              {inGroup.map((chip) => (
                <Button
                  key={chip.id}
                  title={
                    chip.chrome && kind === 'claude'
                      ? `${t(`figma.tip.${chip.id}`)} ${t('figma.tip.chromeCheck')}`
                      : t(`figma.tip.${chip.id}`)
                  }
                  onClick={() => {
                    safePaste(
                      term,
                      chipPrompt(
                        chip,
                        kind,
                        t(`figma.prompt.${chip.id}`),
                        t('figma.prompt.chromeCheck'),
                        onLine.current ? undefined : link.url,
                      ),
                    );
                    term.focus();
                    setLink(null);
                  }}
                >
                  {t(`figma.chip.${chip.id}`)}
                </Button>
              ))}
            </TermChipGroup>
          );
        })}
      </TermChips>
    </TermOverlay>
  );
}
