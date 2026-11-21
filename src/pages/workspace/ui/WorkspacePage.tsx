import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@design-system/react';
import { api, type SessionKind } from '@/shared/api';
import { I18nContext, translator } from '@/shared/i18n';
import { withShortcut } from '@/shared/lib/shortcuts';
import { AccountSwitch } from '@/features/switch-account';
import { SetupAccount } from '@/features/setup-account';
import {
  CleanupWorktreesDialog,
  OpenInWorktreeDialog,
  loadLinkedWorktrees,
  useLinkedWorktrees,
} from '@/features/open-in-worktree';
import { SettingsMenu, openSettingsMenu } from '@/features/switch-language';
import { nextWaiting, summonTarget } from '@/features/next-waiting';
import { ReviewQueue, useReviewQueue } from '@/features/review-queue';
import { SessionCommandsModal } from '@/features/session-commands';
import { GlobalShortcutDialog } from '@/features/global-shortcut';
import { copyLastReply, toggleQuickSelect } from '@/features/terminal-helpers';
import { openFind } from '@/features/terminal-search';
import { focusSession } from '@/entities/session';
import { FirstRunChecklist, useFirstRun } from '@/features/first-run';
import { GuideButton, GuideModal, GuideOffer, guideMedia, useGuide } from '@/features/guide';
import { ReleaseNotesModal, useReleaseNotes } from '@/features/release-notes';
import { ManageProjectsDialog, useManageProjects } from '@/features/manage-projects';
import { FigmaSettings, LOGIN_COMMAND, typeWhenSettled } from '@/features/figma';
import { FullscreenBar, FullscreenButton, useFullscreen } from '@/features/fullscreen';
import { Sidebar } from '@/widgets/sidebar';
import { SessionTabs } from '@/widgets/session-tabs';
import { SplitView, focusedOnly } from '@/widgets/split-view';
import { ChangesPanel } from '@/widgets/changes-panel';
import { PreviewPanel } from '@/widgets/preview';
import { HistoryPanel } from '@/widgets/history-panel';
import { UsageGauge } from '@/widgets/usage-gauge';
import { TrendsButton, TrendsModal, hasCliUpdate, useTrends } from '@/widgets/trends';
import { CommandPalette, type ActionId } from '@/widgets/command-palette';
import { useWorkspace } from '../model/useWorkspace';
import { useShortcuts } from '../model/useShortcuts';

export default function WorkspacePage() {
  const ws = useWorkspace();
  const [changesOpen, setChangesOpen] = useState(false);
  const toggleChanges = useCallback(() => setChangesOpen((o) => !o), []);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFullOn, setPreviewFull] = useState(false);
  const togglePreview = useCallback(() => setPreviewOpen((o) => !o), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = useCallback(() => setHistoryOpen((o) => !o), []);
  const [trendsOpen, setTrendsOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  // T43: the tab whose title is being edited; when the edit ends, typing goes back to its terminal.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const renamingRef = useRef<string | null>(null);
  const renameTab = useCallback((id: string | null) => {
    const prev = renamingRef.current;
    renamingRef.current = id;
    setRenamingId(id);
    if (!id && prev) requestAnimationFrame(() => focusSession(prev));
  }, []);
  // Another tab or project took over (its input may be gone without a blur): the edit is over.
  useEffect(() => {
    if (renamingRef.current && renamingRef.current !== ws.activeSessionId) {
      renamingRef.current = null;
      setRenamingId(null);
    }
  }, [ws.activeSessionId]);
  const trends = useTrends();
  const [worktreeOpen, setWorktreeOpen] = useState(false);
  const openWorktreeDialog = useCallback(() => setWorktreeOpen(true), []);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const openCleanup = useCallback(() => setCleanupOpen(true), []);
  const firstRun = useFirstRun();
  const { reopen: reopenFirstRun } = firstRun;
  const guide = useGuide();
  const { toggle: toggleGuide, show: showGuide } = guide;
  const notes = useReleaseNotes();
  const fullscreen = useFullscreen();
  const { toggle: toggleFullscreen } = fullscreen;
  const { showAll: showNotes } = notes;
  const { sessions, activeSessionId: focusedId, selectSession } = ws;
  const waitingNext = nextWaiting(sessions, focusedId);
  const goNextWaiting = useCallback(() => {
    if (waitingNext) selectSession(waitingNext);
  }, [waitingNext, selectSession]);
  // Review queue (T58): finished off screen, not looked at yet.
  const review = useReviewQueue(sessions, ws.split.visibleSessionIds);
  const reviewNext = review.next(focusedId);
  const goNextReview = useCallback(() => {
    if (reviewNext) selectSession(reviewNext);
  }, [reviewNext, selectSession]);
  // Global shortcut (T41): main already brought the window up; go to the session that needs the user.
  const [globalShortcutOpen, setGlobalShortcutOpen] = useState(false);
  const summonRef = useRef({ sessions, focusedId, selectSession });
  summonRef.current = { sessions, focusedId, selectSession };
  useEffect(
    () =>
      api.onGlobalShortcut(({ wasFocused }) => {
        const { sessions: list, focusedId: active, selectSession: select } = summonRef.current;
        const target = summonTarget(list, active, wasFocused);
        if (target) select(target);
      }),
    [],
  );
  const focusedSession = sessions.find((x) => x.id === focusedId);
  const agentFocused = !!focusedSession && focusedSession.kind !== 'shell' && !focusedSession.dormant;
  const copyReply = useCallback(() => {
    if (focusedId && agentFocused) void copyLastReply(focusedId);
  }, [focusedId, agentFocused]);
  const quickSelect = useCallback(() => {
    if (focusedId && focusedSession && !focusedSession.dormant) toggleQuickSelect(focusedId);
  }, [focusedId, focusedSession]);
  const find = useCallback(() => {
    if (focusedId && focusedSession && !focusedSession.dormant) openFind(focusedId);
  }, [focusedId, focusedSession]);
  // Menu-only items of the app menu bar (T47). Their handlers are defined further down: read through a ref.
  const menuRef = useRef({
    settings: () => {},
    addProject: () => {},
    whatsNew: () => {},
    connectFigma: () => {},
  });
  const menuCommands = useMemo(
    () => ({
      settings: () => menuRef.current.settings(),
      addProject: () => menuRef.current.addProject(),
      whatsNew: () => menuRef.current.whatsNew(),
      connectFigma: () => menuRef.current.connectFigma(),
    }),
    [],
  );
  useShortcuts({
    config: ws.config,
    activeSessionId: ws.activeSessionId,
    openSession: ws.openSession,
    closeSession: ws.closeSession,
    selectProject: ws.selectProject,
    splitFocused: ws.split.splitFocused,
    moveFocus: ws.split.moveFocus,
    toggleZoom: ws.split.toggleZoom,
    toggleFullscreen,
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
    find,
    menu: menuCommands,
  });

  const { config, project, activeSessionId, openSession, closeSession, setConfig, showError } = ws;
  // Only while the preview is actually shown: a remote project or full window would otherwise leave nothing on screen.
  const previewFull = previewFullOn && previewOpen && !fullscreen.on && !!project && !project.remote;
  const { openWorktreeSession } = ws;
  // Worktrees (T7/T38) are local-only.
  const localProjectId = project && !project.remote ? project.id : undefined;
  const paletteWorktrees = useLinkedWorktrees(localProjectId, paletteOpen);
  const openInWorktree = useCallback(
    (branch: string, kind: SessionKind) =>
      void openWorktreeSession(branch, kind).catch((e: unknown) => showError((e as Error).message)),
    [openWorktreeSession, showError],
  );
  const tabWorktrees = useMemo(
    () =>
      localProjectId
        ? {
            load: () => loadLinkedWorktrees(localProjectId),
            onDialog: openWorktreeDialog,
            onOpen: openInWorktree,
            onCleanup: openCleanup,
          }
        : undefined,
    [localProjectId, openWorktreeDialog, openInWorktree, openCleanup],
  );
  const manage = useManageProjects({
    config,
    sessions: ws.sessions,
    onChanged: setConfig,
    onAdded: ws.selectProject,
    onRemoved: ws.forgetProject,
    onError: showError,
  });
  const { addProject, addRemote, openSettings, openIn } = manage;
  menuRef.current = {
    settings: () => {
      if (config)
        void openSettingsMenu(translator(config.language), {
          config,
          onChanged: setConfig,
          onGlobalShortcut: () => setGlobalShortcutOpen(true),
        });
    },
    addProject: () => void addProject(),
    whatsNew: showNotes,
    connectFigma: () => {
      if (project && !project.remote) openSettings(project, 'figma');
    },
  };
  // "Log in from Claude" (T54): a Claude tab with the project's account, `/mcp` typed once the CLI settles.
  const figmaLogin = (projectId: string, account: string) => {
    void openSession('claude', account, projectId).then((id) => {
      if (id) void typeWhenSettled(id, LOGIN_COMMAND);
    });
  };
  const { splitFocused, toggleZoom, paneCount } = ws.split;
  const paletteActions = useMemo(() => {
    const a: Partial<Record<ActionId, () => void>> = {
      splitRight: () => splitFocused('row'),
      splitDown: () => splitFocused('column'),
    };
    if (paneCount > 1) a.zoomPane = toggleZoom;
    if (fullscreen.available) a.fullscreen = toggleFullscreen;
    if (project) {
      a.openClaude = () => openSession('claude');
      a.openCodex = () => openSession('codex');
      a.openShell = () => openSession('shell');
      a.projectSettings = () => openSettings(project);
      // The changes panel works over SSH too (T36); worktrees, preview and "Open in" are local-only.
      a.toggleChanges = toggleChanges;
      if (!project.remote) {
        a.openWorktree = openWorktreeDialog;
        if (paletteWorktrees.length) a.cleanupWorktrees = openCleanup;
        a.togglePreview = togglePreview;
        a.openProjectIn = () => void openIn(project);
        a.connectFigma = () => openSettings(project, 'figma');
      }
    }
    a.addProject = () => void addProject();
    a.addRemote = addRemote;
    a.history = toggleHistory;
    if (activeSessionId) a.closeSession = () => closeSession(activeSessionId);
    // Edited in its tab, which full window hides.
    if (activeSessionId && !fullscreen.on) a.renameSession = () => renameTab(activeSessionId);
    if (waitingNext) a.nextWaiting = goNextWaiting;
    if (reviewNext) a.nextReview = goNextReview;
    if (agentFocused) a.copyLastReply = copyReply;
    // T59: local Claude tabs (remote transcripts live on the host).
    if (agentFocused && focusedSession.kind === 'claude' && !focusedSession.remote)
      a.sessionCommands = () => setCommandsOpen(true);
    if (focusedSession && !focusedSession.dormant) {
      a.quickSelect = quickSelect;
      a.find = find;
    }
    a.globalShortcut = () => setGlobalShortcutOpen(true);
    a.firstRun = reopenFirstRun;
    a.guide = showGuide;
    a.whatsNew = showNotes;
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
    fullscreen.available,
    fullscreen.on,
    renameTab,
    toggleFullscreen,
    toggleChanges,
    togglePreview,
    openWorktreeDialog,
    paletteWorktrees.length,
    openCleanup,
    setConfig,
    showError,
    waitingNext,
    goNextWaiting,
    reviewNext,
    goNextReview,
    reopenFirstRun,
    showGuide,
    showNotes,
    toggleHistory,
    addProject,
    addRemote,
    openSettings,
    openIn,
    agentFocused,
    copyReply,
    focusedSession,
    quickSelect,
    find,
  ]);

  if (!config) return null;
  const t = translator(config.language);

  return (
    <I18nContext.Provider value={t}>
      <div className="app">
        {!fullscreen.on && !previewFull && (
          <Sidebar
            config={config}
            sessions={ws.sessions}
            activeProjectId={ws.activeProjectId}
            onSelect={ws.selectProject}
            onShowSession={ws.selectSession}
            manage={manage}
            belowProjects={
              review.items.length > 0 && (
                <ReviewQueue items={review.items} projects={config.projects} onShow={ws.selectSession} />
              )
            }
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
                <SettingsMenu
                  config={config}
                  onChanged={ws.setConfig}
                  onGlobalShortcut={() => setGlobalShortcutOpen(true)}
                />
                <TrendsButton
                  open={trendsOpen}
                  onClick={() => setTrendsOpen((o) => !o)}
                  update={hasCliUpdate(trends.state)}
                />
                <GuideButton open={guide.open} onClick={toggleGuide} onWhatsNew={showNotes} />
              </>
            }
          />
        )}
        <main className="app__main" hidden={previewFull}>
          {fullscreen.on ? (
            <FullscreenBar config={config} session={focusedSession} onExit={toggleFullscreen} />
          ) : (
            <SessionTabs
              config={config}
              sessions={ws.projectSessions}
              activeId={ws.activeSessionId}
              onSelect={ws.selectSession}
              onClose={ws.closeSession}
              onNew={ws.openSession}
              defaultKind={project?.defaultAgent}
              worktrees={tabWorktrees}
              renamingId={renamingId}
              onRename={renameTab}
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
                    <Button
                      variant="ghost"
                      glyph="±"
                      label={t('changes.label')}
                      aria-pressed={changesOpen}
                      onClick={toggleChanges}
                      title={withShortcut(t('changes.toggle'), 'toggleChanges')}
                      aria-label={t('changes.label')}
                    />
                    {!project.remote && (
                      <Button
                        variant="ghost"
                        glyph="◫"
                        label={t('preview.label')}
                        aria-pressed={previewOpen}
                        onClick={togglePreview}
                        title={withShortcut(t('preview.toggle'), 'togglePreview')}
                        aria-label={t('preview.label')}
                      />
                    )}
                    {fullscreen.available && <FullscreenButton onClick={toggleFullscreen} />}
                  </>
                )
              }
            />
          )}
          {ws.error && (
            <div className="app__error" role="alert" onClick={ws.clearError}>
              {ws.error}
            </div>
          )}
          <SplitView
            config={config}
            sessions={ws.sessions}
            layout={fullscreen.on ? focusedOnly(ws.split.layout) : ws.split.layout}
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
            renderFigma={(p) => (
              <FigmaSettings
                key={p.account}
                {...p}
                agentTabs={
                  ws.sessions.filter(
                    (s) =>
                      s.projectId === p.projectId &&
                      s.kind !== 'shell' &&
                      !s.remote &&
                      !s.dormant &&
                      !s.exited,
                  ).length
                }
                onReopen={() => void ws.reopenAgentTabs(p.projectId)}
                onLogin={(account) => figmaLogin(p.projectId, account)}
              />
            )}
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
        {cleanupOpen && project && !project.remote && (
          <CleanupWorktreesDialog key={project.id} project={project} onClose={() => setCleanupOpen(false)} />
        )}
        {globalShortcutOpen && <GlobalShortcutDialog onClose={() => setGlobalShortcutOpen(false)} />}
        {commandsOpen && focusedSession && (
          <SessionCommandsModal
            key={focusedSession.id}
            session={focusedSession}
            onClose={() => setCommandsOpen(false)}
          />
        )}
        {/* Full window hides the side panels too; their open state is kept for when it ends. */}
        {changesOpen && !fullscreen.on && !previewFull && (
          <ChangesPanel
            project={project}
            session={ws.sessions.find((x) => x.id === activeSessionId)}
            onClose={() => setChangesOpen(false)}
          />
        )}
        {/* Last column: the native preview view only has to follow its own size and the window. */}
        {previewOpen && !fullscreen.on && project && !project.remote && (
          <PreviewPanel
            key={project.id}
            project={project}
            session={ws.sessions.find((x) => x.id === activeSessionId)}
            full={previewFull}
            onToggleFull={() => setPreviewFull((f) => !f)}
            onClose={() => {
              setPreviewOpen(false);
              setPreviewFull(false);
            }}
            onConnectFigma={() => openSettings(project, 'figma')}
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
        <GuideModal
          open={guide.open}
          onClose={guide.close}
          language={config.language}
          initialId={guide.focusId}
        />
        <ReleaseNotesModal
          open={notes.open}
          onClose={notes.close}
          notes={notes.notes}
          language={config.language}
          mediaFor={guideMedia}
          onHowTo={(id) => {
            notes.close();
            showGuide(id);
          }}
        />
        <TrendsModal
          open={trendsOpen}
          onClose={() => setTrendsOpen(false)}
          trends={trends}
          language={config.language}
          account={project && !project.remote ? project.account : undefined}
        />
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
          worktrees={paletteWorktrees}
          onOpenWorktree={localProjectId ? openInWorktree : undefined}
        />
      </div>
    </I18nContext.Provider>
  );
}
