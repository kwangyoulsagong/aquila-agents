import { lazyComponent } from '@/shared/lib/lazyComponent';
export const OpenInWorktreeDialog = lazyComponent(() => import('./ui/OpenInWorktreeDialog'));
export const CleanupWorktreesDialog = lazyComponent(() => import('./ui/CleanupWorktreesDialog'));
export { worktreeMenuItems, parseWorktreeMenuId, worktreeLabel, worktreeRef } from './model/menu';
export { useLinkedWorktrees, loadLinkedWorktrees } from './model/useLinkedWorktrees';
