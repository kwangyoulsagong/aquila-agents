import { Button } from '@design-system/react';
import { useT } from '@/shared/i18n';

/** ✦ in the sidebar's top band: opens AI trends. No badge: nothing is fetched until it's opened. */
export default function TrendsButton({ open, onClick }: { open: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <Button
      variant="ghost"
      icon
      aria-pressed={open}
      onClick={onClick}
      title={t('trends.open')}
      aria-label={t('trends.open')}
    >
      ✦
    </Button>
  );
}
