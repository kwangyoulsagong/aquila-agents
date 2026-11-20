import type { WorktreeCandidate } from '@/shared/api';

/** Suggested for removal: merged into the base branch, clean, and no tab runs in it. */
export const suggested = (c: WorktreeCandidate): boolean => c.merged && c.clean && !c.open;

/** Removable at all without `--force`: clean and not open (the branch is kept either way). */
export const removable = (c: WorktreeCandidate): boolean => c.clean && !c.open;

/** Suggested ones first, then by branch. */
export const sortCandidates = (list: WorktreeCandidate[]): WorktreeCandidate[] =>
  [...list].sort((a, b) => Number(suggested(b)) - Number(suggested(a)) || a.branch.localeCompare(b.branch));
