import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@design-system/react';
import { api, type GraphNode, type SessionKind } from '@/shared/api';
import { I18nContext, translator } from '@/shared/i18n';
import { withShortcut } from '@/shared/lib/shortcuts';
import { preloadLazyComponents } from '@/shared/lib/lazyComponent';
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
import { SourcesDialog } from '@/features/graph-sources';
import { LinkSettingsDialog, LinkSuggestions } from '@/features/link-suggestions';
import { NoteEditorPanel, QuickOpen } from '@/features/edit-note';
import { ChangedNotes, NoteReviewBar } from '@/features/note-review';
import { NoteReferences, useNoteIds } from '@/features/note-ids';
import { MentionRow } from '@/features/link-mentions';
import { VaultNoteSide, VaultNoteTop, VaultSettingsDialog, VaultViewModal } from '@/features/vault-settings';
import { NoteProperties } from '@/features/note-properties';
import { WhatIsThisButton, WhatIsThisDialog, type BriefSeed } from '@/features/what-is-this';
import { copyLastReply, toggleQuickSelect } from '@/features/terminal-helpers';
import { openFind } from '@/features/terminal-search';
import { focusSession } from '@/entities/session';
import { openSessionNode } from '@/entities/note';
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
import { RunPanel } from '@/features/run-slot';
import { HistoryPanel } from '@/widgets/history-panel';
import { KnowledgeGraphPanel } from '@/widgets/knowledge-graph';
import {
  ExtensionChips,
  ExtensionPanel,
  NewExtensionDialog,
  extensionCommands,
  useExtensions,
} from '@/widgets/extension-panel';
import { UsageGauge } from '@/widgets/usage-gauge';
import { TrendsButton, TrendsModal, hasCliUpdate, useTrends } from '@/widgets/trends';
import { TrendApplyModal, type ApplyItem } from '@/widgets/trend-apply';
import { pasteWhenReady } from '@/features/apply-trend';
import { CommandPalette, type ActionId } from '@/widgets/command-palette';
import { NoteTableModal } from '@/widgets/note-table';
import { useWorkspace } from '../model/useWorkspace';
import { useShortcuts } from '../model/useShortcuts';
import { usePanelFit, type PanelId } from '../model/panels';

export default function WorkspacePage() {
  const ws = useWorkspace();
  // Dialogs and panels are separate chunks (off the startup path); fetch them right after the first frame, so they
  // are there before anyone opens one (a dialog opened while its chunk loads would miss the first keys typed).
  useEffect(() => {
    const id = setTimeout(preloadLazyComponents, 0);
    return () => clearTimeout(id);
  }, []);
  const [changesOpen, setChangesOpen] = useState(false);
  const toggleChanges = useCallback(() => setChangesOpen((o) => !o), []);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFullOn, setPreviewFull] = useState(false);
  const togglePreview = useCallback(() => setPreviewOpen((o) => !o), []);
  // Run slot (T60); "Open in preview" opens the preview on the run's address.
  const [runOpen, setRunOpen] = useState(false);
  const toggleRun = useCallback(() => setRunOpen((o) => !o), []);
  // Knowledge graph (T66): not tied to a project; right panel or full window.
  const [graphOpen, setGraphOpen] = useState(false);
  const [graphFullOn, setGraphFull] = useState(false);
  const toggleGraph = useCallback(() => setGraphOpen((o) => !o), []);
  // Extensions (T71): the user's own panels from ~/.aquila/extensions; one shown at a time.
  const extList = useExtensions();
  const [extOpen, setExtOpen] = useState(false);
  const [extId, setExtId] = useState<string | null>(null);
  const [newExtOpen, setNewExtOpen] = useState(false);
  const toggleExtensions = useCallback(() => setExtOpen((o) => !o), []);
  const openExtension = useCallback((id: string) => {
    setExtId(id);
    setExtOpen(true);
  }, []);
  // Note editor (T67): one note at a time, opened from the graph, ⌘O or a link; right panel or full window.
  const [notePath, setNotePath] = useState<string | null>(null);
  // T79: requirement IDs in the editor (CodeMirror loads with the editor; this is only a loader).
  const noteIds = useNoteIds(setNotePath);
  const [noteFullOn, setNoteFull] = useState(false);
  const [quickOpenOn, setQuickOpen] = useState(false);
  const quickOpen = useCallback(() => setQuickOpen(true), []);
  const [previewRequest, setPreviewRequest] = useState<{ url: string; at: number } | null>(null);
  const clearPreviewRequest = useCallback(() => setPreviewRequest(null), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const togglePalette = useCallback(() => setPaletteOpen((o) => !o), []);
  const [historyOpen, setHistoryOpen] = useState(false);
  const toggleHistory = useCallback(() => setHistoryOpen((o) => !o), []);
  const [trendsOpen, setTrendsOpen] = useState(false);
  // Apply a trend (T64): the item being applied (its modal replaces the trends modal).
  const [applyItem, setApplyItem] = useState<ApplyItem | null>(null);
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
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  // Folder settings (T69) and a source's board / table / list view.
  const [vaultOpen, setVaultOpen] = useState<{ source?: string } | null>(null);
  const [vaultView, setVaultView] = useState<{ sourceId: string; viewId: string } | null>(null);
  // T78: the table view, opened from a note (its source and folder) or ⌘K.
  const [noteTable, setNoteTable] = useState<{ path?: string } | null>(null);
  // "What is this?" (T81): open with an optional dropped file / text.
  const [briefOpen, setBriefOpen] = useState<{ seed?: BriefSeed } | null>(null);
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
    toggleRun,
    toggleGraph,
    quickOpen,
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
  // The graph's project choice (T73): local projects only (a remote project's notes aren't on this machine).
  const graphProjects = useMemo(
    () =>
      (config?.projects ?? [])
        .filter((p) => !p.remote)
        .map((p) => ({ id: p.id, name: p.name, path: p.path })),
    [config?.projects],
  );
  // Only while the preview is actually shown: a remote project or full window would otherwise leave nothing on screen.
  const previewFull = previewFullOn && previewOpen && !fullscreen.on && !!project && !project.remote;
  const graphFull = graphFullOn && graphOpen && !fullscreen.on && !previewFull;
  const noteFull = noteFullOn && !!notePath && !fullscreen.on && !previewFull && !graphFull;
  // One panel alone in the window: the sidebar, the terminals and the other panels step aside.
  const panelFull = previewFull || graphFull || noteFull;
  // More side panels than the window holds: the oldest one closes (changes · run · preview).
  const local = !!project && !project.remote;
  const closePanel = useCallback((p: PanelId) => {
    if (p === 'changes') setChangesOpen(false);
    else if (p === 'run') setRunOpen(false);
    else if (p === 'extensions') setExtOpen(false);
    else if (p === 'graph') {
      setGraphOpen(false);
      setGraphFull(false);
    } else if (p === 'note') {
      setNotePath(null);
      setNoteFull(false);
    } else {
      setPreviewOpen(false);
      setPreviewFull(false);
    }
  }, []);
  usePanelFit(
    {
      changes: changesOpen,
      run: runOpen,
      extensions: extOpen,
      preview: previewOpen,
      graph: graphOpen,
      note: !!notePath,
    },
    {
      changes: changesOpen && !fullscreen.on && !panelFull,
      run: runOpen && !fullscreen.on && !panelFull && local,
      extensions: extOpen && !fullscreen.on && !panelFull,
      preview: previewOpen && !fullscreen.on && local && !graphFull && !noteFull,
      graph: graphOpen && !fullscreen.on && !previewFull && !noteFull,
      note: !!notePath && !fullscreen.on && !previewFull && !graphFull,
    },
    closePanel,
  );
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
          onSources: () => setSourcesOpen(true),
          onLinks: () => setLinksOpen(true),
          onVault: () => setVaultOpen({}),
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
  // A note's Claude action (T69): a Claude tab in the note's project (else the selected one) with the prompt and
  // `@note` pasted, not sent — after the "trust this folder?" answer if Claude asks.
  const sendNoteToClaude = (prompt: string, projectId: string | undefined) => {
    const target = projectId ?? ws.activeProjectId;
    if (!target) return showError(t('vault.noProject'));
    if (target !== ws.activeProjectId) ws.selectProject(target);
    void openSession('claude', undefined, target).then((id) => {
      if (id) void pasteWhenReady(id, prompt);
    });
  };
  // "Referenced in" (T79): a session node → its tab to the front or resumed, as in the graph.
  const openGraphSession = (n: GraphNode) =>
    void openSessionNode(n, {
      sessions: ws.sessions,
      onShow: ws.selectSession,
      onResumed: ws.adoptResumed,
      onError: ws.showError,
    });
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
        a.toggleRun = toggleRun;
        a.openProjectIn = () => void openIn(project);
        a.connectFigma = () => openSettings(project, 'figma');
      }
    }
    a.addProject = () => void addProject();
    a.addRemote = addRemote;
    a.history = toggleHistory;
    a.toggleGraph = toggleGraph;
    a.toggleExtensions = toggleExtensions;
    a.newExtension = () => setNewExtOpen(true);
    a.quickOpen = quickOpen;
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
    a.sources = () => setSourcesOpen(true);
    a.links = () => setLinksOpen(true);
    a.vault = () => setVaultOpen({});
    a.noteTable = () => setNoteTable({ path: notePath ?? undefined });
    a.whatIsThis = () => setBriefOpen({});
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
    toggleRun,
    toggleGraph,
    toggleExtensions,
    quickOpen,
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
    notePath,
  ]);

  // ⌘K: each enabled extension's manifest commands open it and send the command.
  const language = config?.language;
  const paletteExtra = useMemo(() => {
    const tr = translator(language);
    return extensionCommands(extList ?? []).map((c) => ({
      id: c.id,
      label: tr('ext.command', { name: c.name, title: c.title }),
      run: () => {
        openExtension(c.extensionId);
        api.extensionsCommand(c.extensionId, c.commandId);
      },
    }));
  }, [extList, language, openExtension]);

  if (!config) return null;
  const t = translator(config.language);
  // A new extension's folder joins the current local project's group and account (else the first ones).
  const extGroup = project && !project.remote ? project.group : (config.groups[0]?.id ?? '');
  const extAccount = project && !project.remote ? project.account : (Object.keys(config.accounts)[0] ?? '');

  return (
    <I18nContext.Provider value={t}>
      <div className="app">
        {!fullscreen.on && !panelFull && (
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
              <>
                <UsageGauge
                  config={config}
                  onOpenWith={
                    project && !project.remote ? (account) => void openSession('claude', account) : undefined
                  }
                />
                <ExtensionChips list={extList} onOpen={openExtension} />
              </>
            }
            footer={
              <>
                <SettingsMenu
                  config={config}
                  onChanged={ws.setConfig}
                  onGlobalShortcut={() => setGlobalShortcutOpen(true)}
                  onSources={() => setSourcesOpen(true)}
                  onLinks={() => setLinksOpen(true)}
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
        <main className="app__main" hidden={panelFull}>
          {fullscreen.on ? (
            <FullscreenBar config={config} session={focusedSession} onExit={toggleFullscreen} />
          ) : (
            <SessionTabs
              config={config}
              sessions={ws.projectSessions}
              activeId={ws.activeSessionId}
              onSelect={ws.selectSession}
              onClose={ws.closeSession}
              onReorder={ws.reorderSession}
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
                    {!project.remote && (
                      <Button
                        variant="ghost"
                        glyph="▶"
                        label={t('run.label')}
                        aria-pressed={runOpen}
                        onClick={toggleRun}
                        title={withShortcut(t('run.toggle'), 'toggleRun')}
                        aria-label={t('run.label')}
                      />
                    )}
                    <Button
                      variant="ghost"
                      glyph="⧉"
                      label={t('ext.label')}
                      aria-pressed={extOpen}
                      onClick={toggleExtensions}
                      title={t('ext.toggle')}
                      aria-label={t('ext.label')}
                    />
                    <Button
                      variant="ghost"
                      glyph="◉"
                      label={t('graph.label')}
                      aria-pressed={graphOpen}
                      onClick={toggleGraph}
                      title={withShortcut(t('graph.toggle'), 'toggleGraph')}
                      aria-label={t('graph.label')}
                    />
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
            key={`worktree:${project.id}`}
            project={project}
            onClose={() => setWorktreeOpen(false)}
            onOpen={ws.openWorktreeSession}
          />
        )}
        {cleanupOpen && project && !project.remote && (
          <CleanupWorktreesDialog
            key={`cleanup:${project.id}`}
            project={project}
            onClose={() => setCleanupOpen(false)}
          />
        )}
        {newExtOpen && (
          <NewExtensionDialog
            group={extGroup}
            account={extAccount}
            onClose={() => setNewExtOpen(false)}
            onCreated={(created) => {
              setNewExtOpen(false);
              setConfig(created.config);
              openExtension(created.id);
              ws.selectProject(created.projectId);
              void openSession('claude', undefined, created.projectId);
            }}
          />
        )}
        {globalShortcutOpen && <GlobalShortcutDialog onClose={() => setGlobalShortcutOpen(false)} />}
        {sourcesOpen && <SourcesDialog onClose={() => setSourcesOpen(false)} />}
        {linksOpen && <LinkSettingsDialog onClose={() => setLinksOpen(false)} />}
        {vaultOpen && (
          <VaultSettingsDialog
            initialSource={vaultOpen.source}
            onClose={() => setVaultOpen(null)}
            onOpenView={(sourceId, viewId) => {
              setVaultOpen(null);
              setVaultView({ sourceId, viewId });
            }}
          />
        )}
        {vaultView && (
          <VaultViewModal
            key={`${vaultView.sourceId}:${vaultView.viewId}`}
            sourceId={vaultView.sourceId}
            viewId={vaultView.viewId}
            onClose={() => setVaultView(null)}
            onOpenNote={setNotePath}
          />
        )}
        {noteTable && (
          <NoteTableModal
            initialPath={noteTable.path}
            onClose={() => setNoteTable(null)}
            onOpenNote={setNotePath}
          />
        )}
        {briefOpen && (
          <WhatIsThisDialog
            projectId={localProjectId ?? null}
            seed={briefOpen.seed}
            onClose={() => setBriefOpen(null)}
            onOpenNote={(p) => {
              setBriefOpen(null);
              setNotePath(p);
            }}
          />
        )}
        <QuickOpen open={quickOpenOn} onClose={() => setQuickOpen(false)} onPick={setNotePath} />
        {commandsOpen && focusedSession && (
          <SessionCommandsModal
            key={focusedSession.id}
            session={focusedSession}
            onClose={() => setCommandsOpen(false)}
          />
        )}
        {/* Full window hides the side panels too; their open state is kept for when it ends.
            Siblings here need distinct keys: two with the same project id make React mix up their DOM. */}
        {changesOpen && !fullscreen.on && !panelFull && (
          <ChangesPanel
            project={project}
            session={ws.sessions.find((x) => x.id === activeSessionId)}
            onClose={() => setChangesOpen(false)}
          />
        )}
        {runOpen && !fullscreen.on && !panelFull && project && !project.remote && (
          <RunPanel
            key={`run:${project.id}`}
            project={project}
            session={ws.sessions.find((x) => x.id === activeSessionId)}
            onClose={() => setRunOpen(false)}
            onOpenPreview={(url) => {
              setPreviewRequest({ url, at: Date.now() });
              setPreviewOpen(true);
            }}
            onSettings={() => openSettings(project)}
          />
        )}
        {/* The extension's native view follows this panel and the terminal area (useExtensionView). */}
        {extOpen && !fullscreen.on && !panelFull && (
          <ExtensionPanel
            list={extList}
            selected={extId}
            onSelect={setExtId}
            onNew={() => setNewExtOpen(true)}
            onClose={() => setExtOpen(false)}
          />
        )}
        {/* Last column: the native preview view only has to follow its own size and the window. */}
        {notePath && !fullscreen.on && !previewFull && !graphFull && (
          <NoteEditorPanel
            path={notePath}
            full={noteFull}
            onToggleFull={() => setNoteFull((f) => !f)}
            onClose={() => {
              setNotePath(null);
              setNoteFull(false);
            }}
            onOpenNote={setNotePath}
            renderLinks={(p) => (
              <LinkSuggestions {...p} variant="side" onOpen={(n) => n.path && setNotePath(n.path)} />
            )}
            renderTop={(slot) => (
              <>
                <NoteReviewBar slot={slot} />
                <VaultNoteTop slot={slot} onOpenNote={setNotePath} onClaude={sendNoteToClaude} />
                <NoteProperties key={slot.path} slot={slot} onOpenTable={(path) => setNoteTable({ path })} />
              </>
            )}
            extension={noteIds}
            renderMention={(p) => <MentionRow {...p} />}
            renderActions={() => <WhatIsThisButton onOpen={(seed) => setBriefOpen({ seed })} />}
            renderSide={(slot) => (
              <>
                <ChangedNotes path={slot.path} onOpenNote={setNotePath} />
                <NoteReferences
                  path={slot.path}
                  text={slot.version}
                  onOpenNote={setNotePath}
                  onOpenSession={openGraphSession}
                  onOpenFile={(f) => f.path && void api.revealFile(f.path)}
                />
                <VaultNoteSide
                  slot={slot}
                  onOpenNote={setNotePath}
                  onOpenView={(sourceId, viewId) => setVaultView({ sourceId, viewId })}
                />
              </>
            )}
            onClaude={sendNoteToClaude}
            onCreateNote={(name, sourceId) => {
              if (!sourceId) return;
              void api.vaultCreateNote(sourceId, null, name).then((p) => p && setNotePath(p));
            }}
          />
        )}
        {graphOpen && !fullscreen.on && !previewFull && !noteFull && (
          <KnowledgeGraphPanel
            full={graphFull}
            projects={graphProjects}
            activeProjectId={ws.activeProjectId}
            activeSessionId={activeSessionId}
            activeNotePath={notePath}
            sessions={ws.sessions}
            onShowSession={ws.selectSession}
            onClaude={sendNoteToClaude}
            onResumed={ws.adoptResumed}
            onError={ws.showError}
            onToggleFull={() => {
              setNoteFull(false);
              setGraphFull((f) => !f);
            }}
            onOpenNote={(p) => {
              setNotePath(p);
              // From the full-window graph, the note takes the window.
              if (graphFull) {
                setGraphFull(false);
                setNoteFull(true);
              }
            }}
            onClose={() => {
              setGraphOpen(false);
              setGraphFull(false);
            }}
            onSources={() => setSourcesOpen(true)}
            onWhatIsThis={(seed) => setBriefOpen({ seed })}
          />
        )}
        {previewOpen && !fullscreen.on && !graphFull && !noteFull && project && !project.remote && (
          <PreviewPanel
            key={`preview:${project.id}`}
            project={project}
            session={ws.sessions.find((x) => x.id === activeSessionId)}
            full={previewFull}
            request={previewRequest}
            onRequestDone={clearPreviewRequest}
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
          onApply={(item) => {
            setTrendsOpen(false);
            setApplyItem(item);
          }}
        />
        <TrendApplyModal
          item={applyItem}
          projects={config.projects.filter((p) => !p.remote).map((p) => ({ id: p.id, label: p.name }))}
          defaultProjectId={localProjectId}
          language={config.language}
          onClose={() => setApplyItem(null)}
          onStarted={(projectId, { session, prompt }) => {
            setApplyItem(null);
            if (projectId !== ws.activeProjectId) ws.selectProject(projectId);
            ws.adoptResumed({ session });
            // One bracketed block in Claude's prompt, no Enter; after the "trust this folder?" answer if asked.
            void pasteWhenReady(session.id, prompt);
          }}
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
          extra={paletteExtra}
        />
      </div>
    </I18nContext.Provider>
  );
}
