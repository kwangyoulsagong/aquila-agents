import { Button } from '@design-system/react';
import { api } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { accelerator, withShortcut } from '@/shared/lib/shortcuts';

interface Props {
  onClick: () => void;
  open: boolean;
  /** T27: with it, `?` is a native menu — Guide (⌘/) and What's new; without it, `?` opens the guide directly. */
  onWhatsNew?: () => void;
}

/** `?` in the sidebar footer: the guide, and release notes ("What's new"). ⌘/ still opens the guide directly. */
export default function GuideButton({ onClick, open, onWhatsNew }: Props) {
  const t = useT();
  const click = async () => {
    if (!onWhatsNew) return onClick();
    const id = await api.showContextMenu([
      {
        id: 'guide',
        label: t('guide.title'),
        accelerator: accelerator('guide'),
      },
      { id: 'notes', label: t('notes.title') },
    ]);
    if (id === 'guide') onClick();
    else if (id === 'notes') onWhatsNew();
  };
  return (
    <Button
      variant="ghost"
      icon
      aria-pressed={open}
      aria-haspopup={onWhatsNew ? 'menu' : undefined}
      onClick={() => void click()}
      title={withShortcut(onWhatsNew ? t('help.menu') : t('guide.open'), 'guide')}
      aria-label={onWhatsNew ? t('help.menu') : t('guide.open')}
    >
      ?
    </Button>
  );
}
