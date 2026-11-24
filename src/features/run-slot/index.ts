import { lazyComponent } from '@/shared/lib/lazyComponent';
export const RunPanel = lazyComponent(() => import('./ui/RunPanel'));
export { dotFor, pickRun } from './model/runView';
