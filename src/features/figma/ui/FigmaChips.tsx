import { useEffect, useState } from 'react';
import { Button, TermChipGroup, TermChips, TermOverlay } from '@design-system/react';
import { safePaste, useTerminal } from '@/entities/session';
import { useT } from '@/shared/i18n';
import { chipPrompt, chipsFor, parseFigmaLink, type ChipGroup, type FigmaLink } from '../model/link';

const GROUPS: readonly ChipGroup[] = ['design', 'build'];

/**
 * Over a Claude/Codex terminal of a Figma-enabled project (T34): pasting a Figma link offers prompt chips. A chip
 * types its prompt after the link (no Enter); sending the line, or ×, puts the chips away. In Claude tabs, compare and
 * implement also ask for a Claude in Chrome pass over the frame and the running app.
 */
export default function FigmaChips({ sessionId, kind }: { sessionId: string; kind: 'claude' | 'codex' }) {
  const t = useT();
  const term = useTerminal(sessionId);
  const [link, setLink] = useState<FigmaLink | null>(null);

  useEffect(() => {
    const el = term?.element;
    if (!term || !el) return;
    // Capture, and never preventDefault: xterm still pastes the link itself.
    const onPaste = (e: ClipboardEvent) => {
      const found = parseFigmaLink(e.clipboardData?.getData('text/plain') ?? '');
      if (found) setLink(found);
    };
    // Enter sends the line (with or without a chip): the offer is over.
    const typed = term.onData((data) => {
      if (data.includes('\r')) setLink(null);
    });
    el.addEventListener('paste', onPaste, true);
    return () => {
      el.removeEventListener('paste', onPaste, true);
      typed.dispose();
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
                  title={t(`figma.prompt.${chip.id}`)}
                  onClick={() => {
                    safePaste(
                      term,
                      chipPrompt(chip, kind, t(`figma.prompt.${chip.id}`), t('figma.prompt.chromeCheck')),
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
