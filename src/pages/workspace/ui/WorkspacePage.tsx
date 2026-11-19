import { useCallback, useMemo, useState } from 'react';
import { Button } from '@design-system/react';
import { api } from '@/shared/api';
import { I18nContext, translator } from '@/shared/i18n';
import { withShortcut } from '@/shared/lib/shortcuts';
import { AccountSwitch } from '@/features/switch-account';
import { SetupAccount } from '@/features/setup-account';
import { OpenInWorktreeDialog } from '@/features/open-in-worktree';
import { LanguageToggle } from '@/features/switch-language';
import { Sidebar } from '@/widgets/sidebar';
import { SessionTabs } from '@/widgets/session-tabs';
import { SplitView } from '@/widgets/split-view';
import { ChangesPanel } from '@/widgets/changes-panel';
import { CommandPalette, type ActionId } from '@/widgets/command-palette';
import { useWorkspace } from '../model/useWorkspace';
import { useShortcuts } from '../model/useShortcuts';

export default function WorkspacePage() {
  const ws = useWorkspace();
  const [changesOpen, setChangesOpen] = useState(false);
  const toggleChanges = useCallback(() => setChangesOpen((o) => !o), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const openWorktreeDialog = useCallback(() => setWorktreeOpen(true), []);
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
    togglePalette,
  });

  const { config, project, activeSessionId, openSession, closeSession, setConfig, showError } = ws;
  const { splitFocused } = ws.split;
  const paletteActions = useMemo(() => {
    const a: Partial<Record<ActionId, () => void>> = {
      splitRight: () => splitFocused('row'),
      splitDown: () => splitFocused('column'),
    };
    if (project) {
      a.openClaude = () => openSession('claude');
      a.openCodex = () => openSession('codex');
      a.openShell = () => openSession('shell');
      a.openWorktree = openWorktreeDialog;
      a.toggleChanges = toggleChanges;
    }
    if (activeSessionId) a.closeSession = () => closeSession(activeSessionId);
    if (config) {
      a.switchLanguage = () =>
        api
          .setLanguage(config.language === 'ko' ? 'en' : 'ko')
          .then(setConfig)
          .catch((e: unknown) => showError((e as Error).message));
    }
    return a;
  }, [
    project,
    activeSessionId,
    config,
    openSession,
    closeSession,
    splitFocused,
    toggleChanges,
    openWorktreeDialog,
    setConfig,
    showError,
  ]);

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
            onNewInWorktree={project && openWorktreeDialog}
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
                    title={withShortcut(t('changes.toggle'), 'toggleChanges')}
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
        {worktreeOpen && project && (
          <OpenInWorktreeDialog
            key={project.id}
            project={project}
            onClose={() => setWorktreeOpen(false)}
            onOpen={ws.openWorktreeSession}
          />
        )}
        {changesOpen && (
          <ChangesPanel
            project={project}
            session={ws.sessions.find((x) => x.id === activeSessionId)}
            onClose={() => setChangesOpen(false)}
          />
        )}
        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          config={config}
          sessions={ws.sessions}
          activeProjectId={ws.activeProjectId}
          activeSessionId={activeSessionId}
          onSelectProject={ws.selectProject}
          onSelectSession={ws.selectSession}
          actions={paletteActions}
        />
      </div>
    </I18nContext.Provider>
  );
}
