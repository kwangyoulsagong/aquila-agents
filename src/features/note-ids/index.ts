// Requirement IDs (T79): IDs marked in the note editor (hover card, ⌘-click to the defining note), "Referenced in"
// beside the note, and the ID index the graph's lenses use. CodeMirror is loaded with the editor, never from here.
import { lazyComponent } from '@/shared/lib/lazyComponent';
export { useNoteIds } from './model/useNoteIds';
export {
  checklist,
  definesOf,
  idIndex,
  idIssues,
  idsWithNoWork,
  referencedIn,
  type IdIndex,
  type IdInfo,
  type IdState,
} from './model/ids';
export const NoteReferences = lazyComponent(() => import('./ui/NoteReferences'));
export type { NoteReferencesProps } from './ui/NoteReferences';
