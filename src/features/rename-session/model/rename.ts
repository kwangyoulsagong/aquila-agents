/**
 * What to send when an in-place edit ends (T43), or null when nothing changed. Enter on the automatic title as
 * shown doesn't pin it as the user's title; an empty field goes back to the automatic one.
 */
export function renameValue(text: string, current: { title?: string; shown: string }): string | null {
  const next = text.replace(/\s+/g, ' ').trim();
  if (current.title) return next === current.title ? null : next;
  return !next || next === current.shown ? null : next;
}
