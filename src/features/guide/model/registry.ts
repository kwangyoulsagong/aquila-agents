import type { Translate } from '@/shared/i18n';
import type { ShortcutId } from '@/shared/lib/shortcuts';

type Key = Parameters<Translate>[0];

/** Screenshot or short muted loop for a guide item (`npm run capture` writes them to `../media/`, see media.ts). */
export interface GuideMedia {
  src: string;
  kind: 'image' | 'video';
  /** Still frame of a video (reduced motion, power saver). */
  poster?: string;
}

export interface GuideItem {
  id: string;
  titleKey: Key;
  bodyKey: Key;
  /** Shortcuts shown with the item, from the one shortcut map (`project1` + `project9` = the ⌘1–⌘9 range). */
  shortcuts?: readonly ShortcutId[];
}

/** Id of the item whose detail is the full shortcut sheet. */
export const SHORTCUTS_ITEM = 'shortcuts';

/**
 * Every feature, in the order the guide lists them. Add a feature here when you ship one, plus a capture scenario
 * in electron/capture.ts (smoke and the tests fail while an item has no media).
 */
export const GUIDE_ITEMS: readonly GuideItem[] = [
  { id: 'palette', titleKey: 'guide.palette.title', bodyKey: 'guide.palette.body', shortcuts: ['palette'] },
  {
    id: 'sessions',
    titleKey: 'guide.sessions.title',
    bodyKey: 'guide.sessions.body',
    shortcuts: ['openClaude', 'openCodex', 'openShell', 'closeSession'],
  },
  {
    id: 'projects',
    titleKey: 'guide.projects.title',
    bodyKey: 'guide.projects.body',
    shortcuts: ['project1', 'project9'],
  },
  { id: 'status', titleKey: 'guide.status.title', bodyKey: 'guide.status.body' },
  {
    id: 'attention',
    titleKey: 'guide.attention.title',
    bodyKey: 'guide.attention.body',
    shortcuts: ['nextWaiting'],
  },
  { id: 'review', titleKey: 'guide.review.title', bodyKey: 'guide.review.body' },
  { id: 'globalShortcut', titleKey: 'guide.globalShortcut.title', bodyKey: 'guide.globalShortcut.body' },
  { id: 'notify', titleKey: 'guide.notify.title', bodyKey: 'guide.notify.body' },
  {
    id: 'split',
    titleKey: 'guide.split.title',
    bodyKey: 'guide.split.body',
    shortcuts: ['splitRight', 'splitDown'],
  },
  {
    id: 'focus',
    titleKey: 'guide.focus.title',
    bodyKey: 'guide.focus.body',
    shortcuts: ['focusLeft', 'focusRight', 'focusUp', 'focusDown'],
  },
  {
    id: 'zoom',
    titleKey: 'guide.zoom.title',
    bodyKey: 'guide.zoom.body',
    shortcuts: ['zoomPane', 'fullscreen'],
  },
  {
    id: 'resize',
    titleKey: 'guide.resize.title',
    bodyKey: 'guide.resize.body',
    shortcuts: ['resizeLeft', 'resizeRight', 'resizeUp', 'resizeDown'],
  },
  {
    id: 'changes',
    titleKey: 'guide.changes.title',
    bodyKey: 'guide.changes.body',
    shortcuts: ['toggleChanges'],
  },
  {
    id: 'preview',
    titleKey: 'guide.preview.title',
    bodyKey: 'guide.preview.body',
    shortcuts: ['togglePreview'],
  },
  { id: 'run', titleKey: 'guide.run.title', bodyKey: 'guide.run.body', shortcuts: ['toggleRun'] },
  { id: 'graph', titleKey: 'guide.graph.title', bodyKey: 'guide.graph.body', shortcuts: ['toggleGraph', 'quickOpen', 'noteExplorer'] },
  { id: 'figma', titleKey: 'guide.figma.title', bodyKey: 'guide.figma.body' },
  { id: 'designer', titleKey: 'guide.designer.title', bodyKey: 'guide.designer.body' },
  {
    id: 'terminal',
    titleKey: 'guide.terminal.title',
    bodyKey: 'guide.terminal.body',
    shortcuts: ['copyLastReply', 'quickSelect', 'find'],
  },
  { id: 'worktree', titleKey: 'guide.worktree.title', bodyKey: 'guide.worktree.body' },
  { id: 'remote', titleKey: 'guide.remote.title', bodyKey: 'guide.remote.body' },
  {
    id: 'history',
    titleKey: 'guide.history.title',
    bodyKey: 'guide.history.body',
    shortcuts: ['history'],
  },
  { id: 'commands', titleKey: 'guide.commands.title', bodyKey: 'guide.commands.body' },
  { id: 'trends', titleKey: 'guide.trends.title', bodyKey: 'guide.trends.body' },
  { id: 'accounts', titleKey: 'guide.accounts.title', bodyKey: 'guide.accounts.body' },
  { id: 'restore', titleKey: 'guide.restore.title', bodyKey: 'guide.restore.body' },
  { id: 'power', titleKey: 'guide.power.title', bodyKey: 'guide.power.body' },
  { id: 'firstRun', titleKey: 'guide.firstRun.title', bodyKey: 'guide.firstRun.body' },
  { id: 'language', titleKey: 'guide.language.title', bodyKey: 'guide.language.body' },
  {
    id: SHORTCUTS_ITEM,
    titleKey: 'guide.shortcuts.title',
    bodyKey: 'guide.shortcuts.body',
    shortcuts: ['guide'],
  },
];
