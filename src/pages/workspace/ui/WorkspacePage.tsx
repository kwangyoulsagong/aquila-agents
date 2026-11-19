import { I18nContext, translator } from '@/shared/i18n';
import { AccountSwitch } from '@/features/switch-account';
import { LanguageToggle } from '@/features/switch-language';
import { Sidebar } from '@/widgets/sidebar';
import { SessionTabs } from '@/widgets/session-tabs';
import { SessionStage } from '@/widgets/session-stage';
import { useWorkspace } from '../model/useWorkspace';
import { useShortcuts } from '../model/useShortcuts';

export default function WorkspacePage() {
  const ws = useWorkspace();
  useShortcuts({
    config: ws.config,
    activeSessionId: ws.activeSessionId,
    openSession: ws.openSession,
    closeSession: ws.closeSession,
    selectProject: ws.setActiveProjectId,
  });

  const { config, project } = ws;
  if (!config) return null;

  return (
    <I18nContext.Provider value={translator(config.language)}>
      <div className="app">
        <Sidebar
          config={config}
          sessions={ws.sessions}
          activeProjectId={ws.activeProjectId}
          onSelect={ws.setActiveProjectId}
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
            trailing={project && <AccountSwitch config={config} project={project} onChanged={ws.setConfig} />}
          />
          {ws.error && (
            <div className="app__error" role="alert" onClick={ws.clearError}>
              {ws.error}
            </div>
          )}
          <SessionStage
            sessions={ws.sessions}
            project={project}
            activeSessionId={ws.activeSessionId}
            onOpen={ws.openSession}
          />
        </main>
      </div>
    </I18nContext.Provider>
  );
}
