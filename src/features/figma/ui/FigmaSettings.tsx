import { Button, DialogCheck, Dot, Field, Segment } from '@design-system/react';
import { api } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { featureStates, planLabel } from '../model/profile';
import { useFigmaProfile } from '../model/useFigmaProfile';

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  /** The project's Claude account (whose `/mcp` login the check uses). */
  account: string;
}

/** Project settings block: Figma MCP on/off; when on, the connection check, plan hints and the docs link. */
export default function FigmaSettings({ enabled, onChange, account }: Props) {
  const t = useT();
  const { profile, checking, connect } = useFigmaProfile(account);

  const status = (() => {
    if (checking) return { dot: 'working' as const, text: t('figma.checking') };
    if (!profile) return { dot: 'idle' as const, text: t('figma.notChecked') };
    if (profile.state === 'needsAuth') return { dot: 'waiting' as const, text: t('figma.needsAuth') };
    if (profile.state === 'error')
      return { dot: 'error' as const, text: t('figma.error', { error: profile.error ?? '' }) };
    const who = profile.email ?? profile.handle ?? t('figma.unknown');
    const plan = planLabel(profile, t('figma.unknown')) ?? t('figma.unknown');
    return { dot: 'done' as const, text: t('figma.connected', { who, plan }) };
  })();

  return (
    <>
      <Field label={t('figma.title')} hint={t('figma.hint')}>
        <Segment
          label={t('figma.title')}
          value={enabled ? 'on' : 'off'}
          onChange={(v) => onChange(v === 'on')}
          options={[
            { value: 'off', label: t('figma.off') },
            { value: 'on', label: t('figma.on') },
          ]}
        />
      </Field>
      {enabled && (
        <>
          <DialogCheck leading={<Dot status={status.dot} />}>
            <span>{status.text}</span>
          </DialogCheck>
          {profile?.state === 'needsAuth' && <p>{t('figma.codexAuth')}</p>}
          {profile?.state === 'connected' &&
            featureStates(profile).map(({ feature, reason }) => (
              <DialogCheck key={feature} leading={<Dot status={reason ? 'idle' : 'done'} />}>
                <span title={reason ? t(`figma.${reason}`) : undefined}>
                  {t(`figma.${feature}`)}
                  {reason ? ` — ${t(`figma.${reason}`)}` : ''}
                </span>
              </DialogCheck>
            ))}
          <DialogCheck>
            <Button onClick={() => void connect()} disabled={checking}>
              {checking ? t('figma.checking') : t('figma.connect')}
            </Button>
            <Button variant="ghost" onClick={() => void api.figmaOpenDocs()}>
              {t('figma.docs')}
            </Button>
          </DialogCheck>
        </>
      )}
    </>
  );
}
