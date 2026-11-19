import { useEffect, useRef } from 'react';
import { Button, Dialog } from '@design-system/react';
import { useT } from '@/shared/i18n';
import { shortcutLabel } from '@/shared/lib/shortcuts';

interface Props {
  open: boolean;
  onTake: () => void;
  onSkip: () => void;
}

/** Shown once, right after the first-run checklist closes: "Take a tour / Skip". */
export default function GuideOffer({ open, onTake, onSkip }: Props) {
  const t = useT();
  const takeRef = useRef<HTMLButtonElement>(null);

  // showModal() focuses the first button (Skip); start on the primary one.
  useEffect(() => {
    if (open) takeRef.current?.focus();
  }, [open]);

  return (
    <Dialog
      open={open}
      title={t('guide.offer.title')}
      onClose={onSkip}
      actions={
        <>
          <Button variant="ghost" onClick={onSkip}>
            {t('guide.offer.skip')}
          </Button>
          <Button ref={takeRef} variant="primary" onClick={onTake}>
            {t('guide.offer.take')}
          </Button>
        </>
      }
    >
      <p>{t('guide.offer.body')}</p>
      <p>{t('guide.offer.hint', { key: shortcutLabel('guide') })}</p>
    </Dialog>
  );
}
