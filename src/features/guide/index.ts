import { lazyComponent } from '@/shared/lib/lazyComponent';
export const GuideModal = lazyComponent(() => import('./ui/GuideModal'), (p) => p.open);
export { default as GuideOffer } from './ui/GuideOffer';
export { default as GuideButton } from './ui/GuideButton';
export { useGuide, type Guide } from './model/useGuide';
export { GUIDE_ITEMS, type GuideItem, type GuideMedia } from './model/registry';
export { guideMedia } from './model/media';
