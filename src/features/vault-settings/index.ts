// Per-source settings (T69): the settings dialog, a source's board / table / list view, and what the note editor
// shows from them (companion tabs, actions, typed properties). The page passes the editor parts in as slots.
import { lazyComponent } from '@/shared/lib/lazyComponent';
export const VaultSettingsDialog = lazyComponent(() => import('./ui/VaultSettingsDialog'));
export const VaultViewModal = lazyComponent(() => import('./ui/VaultViewModal'));
export const VaultNoteTop = lazyComponent(() => import('./ui/VaultNoteTop'));
export const VaultNoteSide = lazyComponent(() => import('./ui/VaultNoteSide'));
export type { NoteSlot } from './ui/slot';
