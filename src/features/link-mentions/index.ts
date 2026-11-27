// Link an unlinked mention (T79): the first plain mention of a note in another note becomes `[[name]]`, after an
// inline confirm, as a splice through the editor's save path.
import { lazyComponent } from '@/shared/lib/lazyComponent';
export const MentionRow = lazyComponent(() => import('./ui/MentionRow'));
export type { MentionRowProps } from './ui/MentionRow';
export { linkFirstMention, linkName, type Splice } from './model/splice';
