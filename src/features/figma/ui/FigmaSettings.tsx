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
  /** Figma as saved in the config (open tabs were spawned with it). */
  saved: boolean;
  /** Saves the settings dialog; false when it couldn't (the dialog shows why). Closes the dialog on success. */
  save: () => Promise<boolean>;
  /** Live local Claude/Codex tabs of the project: they keep their old MCP setup until reopened. */
  agentTabs: number;
  /** Reopen those tabs (resuming their conversations). */
  onReopen: () => void;
  /** Open a Claude tab with this account and type `/mcp` (T54). */
  onLogin: (account: string) => void;
}

/**
 * Project settings block: Figma MCP on/off; when on, the connection check, "Log in from Claude", plan hints and the
 * docs link. Toggling with tabs open offers "Save and reopen" (T54).
 */
export default function FigmaSettings({
  enabled,
  onChange,
  account,
  saved,
  save,
  agentTabs,
  onReopen,
  onLogin,
}: Props) {
  const t = useT();
  const { profile, checking, connect } = useFigmaProfile(account);
  const pending = enabled !== saved;
  const login = async () => {
    if (pending && !(await save())) return;
    onLogin(account);
  };

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
      {pending && agentTabs > 0 && (
        <DialogCheck leading={<Dot status="waiting" />}>
          <span>{t('figma.reopenNote', { n: String(agentTabs) })}</span>
          <Button onClick={() => void save().then((ok) => ok && onReopen())}>
            {t('figma.saveAndReopen')}
          </Button>
        </DialogCheck>
      )}
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
            {profile?.state !== 'connected' && (
              <Button variant="primary" onClick={() => void login()} title={t('figma.loginHint')}>
                {pending ? t('figma.saveAndLogin') : t('figma.login')}
              </Button>
            )}
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
