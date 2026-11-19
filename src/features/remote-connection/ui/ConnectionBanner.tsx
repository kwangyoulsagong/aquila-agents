import { Button, TermBanner, TermOverlay } from '@design-system/react';
import { api, type Session } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { useNow } from '@/shared/lib/useNow';
import { secondsUntil } from '../model/retry';

/**
 * Over a remote terminal whose connection is lost (T29): what happened, when the next try is, and "Reconnect now".
 * The agent keeps running in tmux on the host, so nothing is lost by waiting.
 */
export default function ConnectionBanner({ session }: { session: Session }) {
  const t = useT();
  const lost = session.connection === 'lost' && !session.exited;
  const now = useNow(1000, lost && session.retryAt !== undefined);
  if (!lost || !session.remote) return null;
  const seconds = secondsUntil(session.retryAt, now);
  return (
    <TermOverlay>
      <TermBanner
        meta={
          <>
            {seconds ? t('remote.retryIn', { seconds: String(seconds) }) : t('remote.retrying')} ·{' '}
            {t('remote.keepsRunning')}
          </>
        }
        action={
          seconds ? (
            <Button variant="ghost" onClick={() => api.reconnect(session.id)}>
              {t('remote.reconnectNow')}
            </Button>
          ) : undefined
        }
      >
        {t('remote.lostBanner', { host: session.remote })}
      </TermBanner>
    </TermOverlay>
  );
}
