import { useCallback, useMemo, useState } from 'react';
import { Button } from '@design-system/react';
import { api } from '@/shared/api';
import { I18nContext, translator } from '@/shared/i18n';
import { withShortcut } from '@/shared/lib/shortcuts';
import { AccountSwitch } from '@/features/switch-account';
import { SetupAccount } from '@/features/setup-account';
import { OpenInWorktreeDialog } from '@/features/open-in-worktree';
import { LanguageToggle } from '@/features/switch-language';
import { nextWaiting } from '@/features/next-waiting';
import { copyLastReply, toggleQuickSelect } from '@/features/terminal-helpers';
import { FirstRunChecklist, useFirstRun } from '@/features/first-run';
import { GuideButton, GuideModal, GuideOffer, useGuide } from '@/features/guide';
import { ManageProjectsDialog, useManageProjects } from '@/features/manage-projects';
import { FigmaSettings } from '@/features/figma';
import { Sidebar } from '@/widgets/sidebar';
import { SessionTabs } from '@/widgets/session-tabs';
import { SplitView } from '@/widgets/split-view';
import { ChangesPanel } from '@/widgets/changes-panel';
import { PreviewPanel } from '@/widgets/preview';
import { HistoryPanel } from '@/widgets/history-panel';
import { UsageGauge } from '@/widgets/usage-gauge';
import { CommandPalette, type ActionId } from '@/widgets/command-palette';
import { useWorkspace } from '../model/useWorkspace';
import { useShortcuts } from '../model/useShortcuts';

export default function WorkspacePage() {
  const ws = useWorkspace();
  const [changesOpen, setChangesOpen] = useState(false);
  const toggleChanges = useCallback(() => setChangesOpen((o) => !o), []);
  const [previewOpen, setPreviewOpen] = useState(false);
  const togglePreview = useCallback(() => setPreviewOpen((o) => !o), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = useCallback(() => setHistoryOpen((o) => !o), []);
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const openWorktreeDialog = useCallback(() => setWorktreeOpen(true), []);
  const firstRun = useFirstRun();
  const { reopen: reopenFirstRun } = firstRun;
  const guide = useGuide();
  const { toggle: toggleGuide, show: showGuide } = guide;
  const { sessions, activeSessionId: focusedId, selectSession } = ws;
  const waitingNext = nextWaiting(sessions, focusedId);
  const goNextWaiting = useCallback(() => {
    if (waitingNext) selectSession(waitingNext);
  }, [waitingNext, selectSession]);
  const focusedSession = sessions.find((x) => x.id === focusedId);
  const agentFocused = !!focusedSession && focusedSession.kind !== 'shell' && !focusedSession.dormant;
  const copyReply = useCallback(() => {
    if (focusedId && agentFocused) void copyLastReply(focusedId);
  }, [focusedId, agentFocused]);
  const quickSelect = useCallback(() => {
    if (focusedId && focusedSession && !focusedSession.dormant) toggleQuickSelect(focusedId);
  }, [focusedId, focusedSession]);
  useShortcuts({
    config: ws.config,
    activeSessionId: ws.activeSessionId,
    openSession: ws.openSession,
    closeSession: ws.closeSession,
    selectProject: ws.selectProject,
    splitFocused: ws.split.splitFocused,
    moveFocus: ws.split.moveFocus,
    toggleZoom: ws.split.toggleZoom,
    nudgePane: ws.split.nudgeFocused,
    closePane: ws.split.closePane,
    toggleChanges,
    togglePreview,
    togglePalette,
    toggleGuide,
    toggleHistory,
    nextWaiting: goNextWaiting,
    copyLastReply: copyReply,
    quickSelect,
  });

  const { config, project, activeSessionId, openSession, closeSession, setConfig, showError } = ws;
  const manage = useManageProjects({
    config,
    sessions: ws.sessions,
    onChanged: setConfig,
    onAdded: ws.selectProject,
    onRemoved: ws.forgetProject,
    onError: showError,
  });
  const { addProject, openSettings, openIn } = manage;
  const { splitFocused, toggleZoom, paneCount } = ws.split;
  const paletteActions = useMemo(() => {
    const a: Partial<Record<ActionId, () => void>> = {
      splitRight: () => splitFocused('row'),
      splitDown: () => splitFocused('column'),
    };
    if (paneCount > 1) a.zoomPane = toggleZoom;
    if (project) {
      a.openClaude = () => openSession('claude');
      a.openCodex = () => openSession('codex');
      a.openShell = () => openSession('shell');
      a.projectSettings = () => openSettings(project);
      // Worktrees, the changes panel and "Open in" are local-only for now (T29; remote panels are T36).
      if (!project.remote) {
        a.openWorktree = openWorktreeDialog;
        a.toggleChanges = toggleChanges;
        a.togglePreview = togglePreview;
        a.openProjectIn = () => void openIn(project);
      }
    }
    a.addProject = () => void addProject();
    a.history = toggleHistory;
    if (activeSessionId) a.closeSession = () => closeSession(activeSessionId);
    if (waitingNext) a.nextWaiting = goNextWaiting;
    if (agentFocused) a.copyLastReply = copyReply;
    if (focusedSession && !focusedSession.dormant) a.quickSelect = quickSelect;
    a.firstRun = reopenFirstRun;
    a.guide = showGuide;
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
    toggleZoom,
    paneCount,
    toggleChanges,
    togglePreview,
    openWorktreeDialog,
    setConfig,
    showError,
    waitingNext,
    goNextWaiting,
    reopenFirstRun,
    showGuide,
    toggleHistory,
    addProject,
    openSettings,
    openIn,
    agentFocused,
    copyReply,
    focusedSession,
    quickSelect,
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
          manage={manage}
          aboveFooter={
            <UsageGauge
              config={config}
              onOpenWith={
                project && !project.remote ? (account) => void openSession('claude', account) : undefined
              }
            />
          }
          footer={
            <>
              <LanguageToggle config={config} onChanged={ws.setConfig} />
              <GuideButton open={guide.open} onClick={toggleGuide} />
            </>
          }
        />
        <main className="app__main">
          <SessionTabs
            config={config}
            sessions={ws.projectSessions}
            activeId={ws.activeSessionId}
            onSelect={ws.selectSession}
            onClose={ws.closeSession}
            onNew={ws.openSession}
            defaultKind={project?.defaultAgent}
            onNewInWorktree={project && !project.remote ? openWorktreeDialog : undefined}
            trailing={
              project && (
                <>
                  <SetupAccount
                    config={config}
                    onOpenClaude={(account) => ws.openSession('claude', account)}
                  />
                  {!project.remote && (
                    <AccountSwitch config={config} project={project} onChanged={ws.setConfig} />
                  )}
                  {!project.remote && (
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
                  )}
                  {!project.remote && (
                    <Button
                      variant="ghost"
                      icon
                      aria-pressed={previewOpen}
                      onClick={togglePreview}
                      title={withShortcut(t('preview.toggle'), 'togglePreview')}
                      aria-label={t('preview.toggle')}
                    >
                      ◫
                    </Button>
                  )}
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
            onToggleZoom={ws.split.toggleZoom}
            onResize={ws.split.resizeSplit}
          />
        </main>
        {manage.dialog && (
          <ManageProjectsDialog
            key={JSON.stringify(manage.dialog)}
            dialog={manage.dialog}
            config={config}
            defaults={{ group: project?.group, account: project?.account }}
            onClose={manage.closeDialog}
            onAdd={manage.submitAdd}
            onName={manage.submitName}
            onRemove={manage.submitRemove}
            onSettings={manage.submitSettings}
            renderFigma={(p) => <FigmaSettings key={p.account} {...p} />}
          />
        )}
        {worktreeOpen && project && !project.remote && (
          <OpenInWorktreeDialog
            key={project.id}
            project={project}
            onClose={() => setWorktreeOpen(false)}
            onOpen={ws.openWorktreeSession}
          />
        )}
        {changesOpen && !project?.remote && (
          <ChangesPanel
            project={project}
            session={ws.sessions.find((x) => x.id === activeSessionId)}
            onClose={() => setChangesOpen(false)}
          />
        )}
        {/* Last column: the native preview view only has to follow its own size and the window. */}
        {previewOpen && project && !project.remote && (
          <PreviewPanel
            key={project.id}
            project={project}
            session={ws.sessions.find((x) => x.id === activeSessionId)}
            onClose={() => setPreviewOpen(false)}
          />
        )}
        {firstRun.open && (
          <FirstRunChecklist
            // Closing the checklist offers the tour once.
            firstRun={{
              ...firstRun,
              close: () => {
                firstRun.close();
                guide.offerOnce();
              },
            }}
            config={config}
            onConfigChanged={ws.setConfig}
            onSelectProject={ws.selectProject}
            onError={ws.showError}
          />
        )}
        <HistoryPanel
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          config={config}
          onResumed={ws.adoptResumed}
          onError={ws.showError}
        />
        <GuideOffer open={guide.offer} onTake={showGuide} onSkip={guide.dismissOffer} />
        <GuideModal open={guide.open} onClose={guide.close} language={config.language} />
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
