import { useCallback, useState } from 'react';
import { Button } from '@design-system/react';
import { I18nContext, translator } from '@/shared/i18n';
import { AccountSwitch } from '@/features/switch-account';
import { SetupAccount } from '@/features/setup-account';
import { LanguageToggle } from '@/features/switch-language';
import { Sidebar } from '@/widgets/sidebar';
import { SessionTabs } from '@/widgets/session-tabs';
import { SplitView } from '@/widgets/split-view';
import { ChangesPanel } from '@/widgets/changes-panel';
import { useWorkspace } from '../model/useWorkspace';
import { useShortcuts } from '../model/useShortcuts';

export default function WorkspacePage() {
  const ws = useWorkspace();
  const [changesOpen, setChangesOpen] = useState(false);
  const toggleChanges = useCallback(() => setChangesOpen((o) => !o), []);
  useShortcuts({
    config: ws.config,
    activeSessionId: ws.activeSessionId,
    openSession: ws.openSession,
    closeSession: ws.closeSession,
    selectProject: ws.selectProject,
    splitFocused: ws.split.splitFocused,
    moveFocus: ws.split.moveFocus,
    closePane: ws.split.closePane,
    toggleChanges,
  });

  const { config, project } = ws;
  if (!config) return null;
  const t = translator(config.language);

  return (
    <I18nContext.Provider value={t}>
      <div className="app">
        <Sidebar
          config={config}
          sessions={ws.sessions}
          activeProjectId={ws.activeProjectId}
          onSelect={ws.selectProject}
          onConfigChanged={ws.setConfig}
          onProjectRemoved={ws.forgetProject}
          onError={ws.showError}
          footer={<LanguageToggle config={config} onChanged={ws.setConfig} />}
        />
        <main className="app__main">
          <SessionTabs
            config={config}
            sessions={ws.projectSessions}
            activeId={ws.activeSessionId}
            onSelect={ws.selectSession}
            onClose={ws.closeSession}
            onNew={ws.openSession}
            trailing={
              project && (
                <>
                  <SetupAccount
                    config={config}
                    onOpenClaude={(account) => ws.openSession('claude', account)}
                  />
                  <AccountSwitch config={config} project={project} onChanged={ws.setConfig} />
                  <Button
                    variant="ghost"
                    icon
                    aria-pressed={changesOpen}
                    onClick={toggleChanges}
                    title={`${t('changes.toggle')} (⌘⇧G)`}
                    aria-label={t('changes.toggle')}
                  >
                    ±
                  </Button>
                </>
              )
            }
          />
          {ws.error && (
            <div className="app__error" role="alert" onClick={ws.clearError}>
              {ws.error}
            </div>
          )}
          <SplitView
            config={config}
            sessions={ws.sessions}
            layout={ws.split.layout}
            project={project}
            onOpen={ws.openSession}
            onFocusPane={ws.split.focusPane}
            onClosePane={ws.split.closePane}
            onDropSession={ws.split.dropSession}
          />
        </main>
        {changesOpen && <ChangesPanel project={project} onClose={() => setChangesOpen(false)} />}
      </div>
    </I18nContext.Provider>
  );
}
