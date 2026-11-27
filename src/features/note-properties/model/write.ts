import { api } from '@/shared/api';
import { removeProp, setProp, type PropValue } from './frontmatter';

export type WriteResult = 'ok' | 'refused' | 'changed' | 'failed';

/**
 * Sets (or with `null` removes) one property of a note that isn't open here (a table cell, T78): reads the file,
 * splices only that key's lines and saves it in place — refused when the file changed since it was read or isn't
 * plain UTF-8. An open editor sees the change like any other write on disk.
 */
export async function writeProp(path: string, key: string, value: PropValue | null): Promise<WriteResult> {
  const f = await api.noteRead(path);
  if (!f) return 'refused';
  if (f.readOnly || f.truncated) return 'refused';
  const next = value === null ? removeProp(f.text, key) : setProp(f.text, key, value);
  if (next === f.text) return 'ok';
  const r = await api.noteWrite(path, next, f.bom, f.mtime);
  return r.ok ? 'ok' : r.reason;
}
