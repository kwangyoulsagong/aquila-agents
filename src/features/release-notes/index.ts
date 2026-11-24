import { lazyComponent } from '@/shared/lib/lazyComponent';
export const ReleaseNotesModal = lazyComponent(() => import('./ui/ReleaseNotesModal'), (p) => p.open);
export { useReleaseNotes, type ReleaseNotesModel } from './model/useReleaseNotes';
export type { ReleaseNotes, ReleaseHeadline } from './model/notes';
