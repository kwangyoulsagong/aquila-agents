import { lazyComponent } from '@/shared/lib/lazyComponent';
export const WhatIsThisDialog = lazyComponent(() => import('./ui/WhatIsThisDialog'));
export { WhatIsThisButton } from './ui/WhatIsThisButton';
export type { BriefSeed } from './model/brief';
