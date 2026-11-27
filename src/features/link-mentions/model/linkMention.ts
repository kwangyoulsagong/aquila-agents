import { api } from '@/shared/api';
import { linkFirstMention } from './splice';

export type LinkMentionResult = 'linked' | 'none' | 'failed';

/**
 * Writes the link into the other note through the editor's own save path: read it (`noteRead`: no watch, no "seen"
 * baseline), splice, write with the mtime it was read at (`noteWrite` refuses when the file changed since). A note
 * that isn't plain UTF-8 or is too big to edit is never written.
 */
export async function linkMention(path: string, title: string, name: string): Promise<LinkMentionResult> {
  const file = await api.noteRead(path);
  if (!file) return 'failed';
  if (file.readOnly || file.truncated) return 'failed';
  const s = linkFirstMention(file.text, title, name);
  if (!s) return 'none';
  const res = await api.noteWrite(path, s.text, file.bom, file.mtime);
  return res.ok ? 'linked' : 'failed';
}
