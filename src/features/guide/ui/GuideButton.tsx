import { Button } from '@design-system/react';
import { useT } from '@/shared/i18n';
import { withShortcut } from '@/shared/lib/shortcuts';

/** `?` in the sidebar footer: opens the guide. */
export default function GuideButton({ onClick, open }: { onClick: () => void; open: boolean }) {
  const t = useT();
  return (
    <Button
      variant="ghost"
      icon
      aria-pressed={open}
      onClick={onClick}
      title={withShortcut(t('guide.open'), 'guide')}
      aria-label={t('guide.open')}
    >
      ?
    </Button>
  );
}
