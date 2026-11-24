import { lazyComponent } from '@/shared/lib/lazyComponent';
export const TrendApplyModal = lazyComponent(() => import('./ui/TrendApplyModal'), (p) => !!p.item);
export type { ApplyItem } from './ui/TrendApplyModal';
