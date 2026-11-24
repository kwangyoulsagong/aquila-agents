import { lazyComponent } from '@/shared/lib/lazyComponent';
export const FigmaSettings = lazyComponent(() => import('./ui/FigmaSettings'));
export {
  featureStates,
  planLabel,
  type FeatureState,
  type FigmaFeature,
  type FigmaReason,
} from './model/profile';
export { default as FigmaChips } from './ui/FigmaChips';
export { parseFigmaLink, type FigmaLink } from './model/link';
export { typeWhenSettled, LOGIN_COMMAND } from './model/login';
