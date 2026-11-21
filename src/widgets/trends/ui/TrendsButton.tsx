import { Button } from '@design-system/react';
import { useT } from '@/shared/i18n';

interface Props {
  open: boolean;
  onClick: () => void;
  /** The last cached fetch found a CLI release newer than the installed one. Never fetches by itself (T35). */
  update?: boolean;
}

/** AI trends in the sidebar footer (a news icon, not ✦ which read as "run AI"): CLI updates · industry. A dot only for a newer CLI version. */
export default function TrendsButton({ open, onClick, update }: Props) {
  const t = useT();
  const label = `${t('trends.title')} · ${t('trends.subtitle')}`;
  return (
    <Button
      variant="ghost"
      icon
      aria-pressed={open}
      onClick={onClick}
      title={update ? `${label} — ${t('trends.updateAvailable')}` : label}
      aria-label={update ? `${t('trends.title')}, ${t('trends.updateAvailable')}` : t('trends.title')}
    >
      <NewsIcon />
      {update && <i className="c-btn__badge" aria-hidden="true" />}
    </Button>
  );
}

/** A folded newspaper, drawn in the text colour. */
function NewsIcon() {
  return (
    <svg
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.5 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 0 1 1H3.5a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1Z" />
      <path d="M12.5 6.5h1v6a1 1 0 0 1-1 1" />
      <path d="M5 5.5h5M5 8h5M5 10.5h3" />
    </svg>
  );
}
