import { lazyComponent } from '@/shared/lib/lazyComponent';
export const HistoryPanel = lazyComponent(() => import('./ui/HistoryPanel'), (p) => p.open);
