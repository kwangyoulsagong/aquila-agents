import { Button } from '@design-system/react';
import type { ExtensionInfo } from '@/shared/api';
import { useT } from '@/shared/i18n';

/**
 * Sidebar band (T71) above the footer: the short text extensions set with `chip.set` (a timer, a CPU %). Click opens
 * that extension in the panel. Nothing shows until one sets a chip.
 */
export default function ExtensionChips({
  list,
  onOpen,
}: {
  list: ExtensionInfo[] | null;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const chips = (list ?? []).filter((e) => e.enabled && e.chip);
  if (!chips.length) return null;
  return (
    <div className="c-ext-chips" role="group" aria-label={t('ext.chips')}>
      {chips.map((e) => (
        <Button
          key={e.id}
          variant="ghost"
          glyph={e.glyph ?? '◇'}
          label={e.chip ?? ''}
          title={e.name}
          aria-label={`${e.name}: ${e.chip}`}
          onClick={() => onOpen(e.id)}
        />
      ))}
    </div>
  );
}
