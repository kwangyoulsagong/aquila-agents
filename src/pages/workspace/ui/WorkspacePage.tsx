import { I18nContext, translator } from '@/shared/i18n';
import { AccountSwitch } from '@/features/switch-account';
import { LanguageToggle } from '@/features/switch-language';
import { Sidebar } from '@/widgets/sidebar';
import { SessionTabs } from '@/widgets/session-tabs';
import { SplitView } from '@/widgets/split-view';
import { useWorkspace } from '../model/useWorkspace';
import { useShortcuts } from '../model/useShortcuts';

export default function WorkspacePage() {
  const ws = useWorkspace();
  useShortcuts({
    config: ws.config,
    activeSessionId: ws.activeSessionId,
    openSession: ws.openSession,
    closeSession: ws.closeSession,
    selectProject: ws.selectProject,
    splitFocused: ws.split.splitFocused,
    moveFocus: ws.split.moveFocus,
    closePane: ws.split.closePane,
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
          onSelect={ws.selectProject}
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
      </div>
    </I18nContext.Provider>
  );
}
