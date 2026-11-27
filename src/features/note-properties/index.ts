// A note's frontmatter as properties (T78): the panel above the editor's text (the page passes it in as a slot),
// and the minimal splice that changes one key — also used by the table view to edit a cell.
import { lazyComponent } from '@/shared/lib/lazyComponent';
export const NoteProperties = lazyComponent(() => import('./ui/NoteProperties'));
export type { PropsSlot } from './ui/NoteProperties';
export {
  readFrontmatter,
  setProp,
  removeProp,
  kindOf,
  validKey,
  type PropValue,
  type PropKind,
} from './model/frontmatter';
export { writeProp, type WriteResult } from './model/write';
