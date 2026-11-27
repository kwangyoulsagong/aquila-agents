import { useState } from 'react';
import { Button } from '@design-system/react';
import { useT } from '@/shared/i18n';
import { readDrop, type BriefSeed } from '../model/brief';

/** Opens "What is this?"; a file or text dropped on it opens the dialog with that input (T81). */
export function WhatIsThisButton({ onOpen }: { onOpen: (seed?: BriefSeed) => void }) {
  const t = useT();
  const [over, setOver] = useState(false);
  return (
    <Button
      variant="ghost"
      title={t('brief.buttonHint')}
      aria-pressed={over || undefined}
      onClick={() => onOpen()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void readDrop(e.dataTransfer, t).then((seed) => onOpen(seed ?? undefined));
      }}
    >
      {t('brief.button')}
    </Button>
  );
}
