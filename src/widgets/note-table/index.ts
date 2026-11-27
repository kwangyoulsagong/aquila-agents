// Table view of a source's notes (T78): rows = notes, columns = frontmatter keys; sort, filter, group, edit a cell.
import { lazyComponent } from '@/shared/lib/lazyComponent';
export const NoteTableModal = lazyComponent(() => import('./ui/NoteTableModal'));
