import { lazyComponent } from '@/shared/lib/lazyComponent';
export { default as TrendsButton } from './ui/TrendsButton';
export const TrendsModal = lazyComponent(() => import('./ui/TrendsModal'), (p) => p.open);
export { useTrends, type Trends } from './model/useTrends';
export { hasCliUpdate } from './model/trends';
