import { lazyComponent } from '@/shared/lib/lazyComponent';
export const FirstRunChecklist = lazyComponent(() => import('./ui/FirstRunChecklist'));
export { useFirstRun, type FirstRun } from './model/useFirstRun';
