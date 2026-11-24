import { lazyComponent } from '@/shared/lib/lazyComponent';
export const CommandPalette = lazyComponent(() => import('./ui/CommandPalette'), (p) => p.open);
export type { ActionId } from './model/commands';
