import { Button, Checklist, ChecklistCommand, ChecklistItem, Dot } from '@design-system/react';
import { api, type RemoteCheck } from '@/shared/api';
import { useT } from '@/shared/i18n';

/** What "Check host" found: reachability, tools (install commands only shown), Claude login, KillUserProcesses. */
export default function RemoteCheckView({ check, host }: { check: RemoteCheck; host: string }) {
  const t = useT();
  if (!check.reachable)
    return (
      <Checklist label={t('remote.check')}>
        <ChecklistItem
          leading={<Dot status="error" />}
          title={t('remote.unreachable', { error: check.error ?? '' })}
          meta={t('remote.unreachableHint', { host })}
        />
      </Checklist>
    );
  const copy = (text: string) => (
    <Button variant="ghost" onClick={() => api.copyText(text)}>
      {t('action.copy')}
    </Button>
  );
  return (
    <Checklist label={t('remote.check')}>
      {check.system && (
        <ChecklistItem leading={<Dot status="done" />} title={t('remote.system', { system: check.system })} />
      )}
      {check.tools.map(({ tool, path, version, install }) => (
        <ChecklistItem
          key={tool}
          // codex is optional; tmux is required for sessions to survive a dropped connection.
          leading={<Dot status={path ? 'done' : tool === 'codex' ? 'idle' : 'error'} />}
          title={path ? t('remote.toolFound', { tool }) : t('remote.toolMissing', { tool })}
          meta={
            path
              ? [version, path].filter(Boolean).join(' · ')
              : tool === 'tmux'
                ? t('remote.tmuxRequired')
                : undefined
          }
        >
          {!path && <ChecklistCommand command={install} action={copy(install)} />}
        </ChecklistItem>
      ))}
      {check.claudeLoggedIn !== undefined && (
        <ChecklistItem
          leading={<Dot status={check.claudeLoggedIn ? 'done' : 'waiting'} />}
          title={check.claudeLoggedIn ? t('remote.loggedIn') : t('remote.loggedOut')}
        />
      )}
      {check.killUserProcesses && (
        <ChecklistItem leading={<Dot status="waiting" />} title={t('remote.killUserProcesses')} />
      )}
    </Checklist>
  );
}
