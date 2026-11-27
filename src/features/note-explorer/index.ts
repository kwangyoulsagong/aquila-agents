// Note explorer (T83): the file tree column of the note editor. Loaded with the editor (its own chunk).
import { lazyComponent } from '@/shared/lib/lazyComponent';
import type { NoteExplorerProps } from './ui/NoteExplorer';

export const NoteExplorer = lazyComponent<NoteExplorerProps>(() => import('./ui/NoteExplorer'));
export type { NoteExplorerProps };
