/**
 * What the note editor hands its slots (structurally the same as `edit-note`'s `NoteSlotProps`; features don't
 * import each other, the page passes it through).
 */
export interface NoteSlot {
  path: string;
  text: () => string;
  version: string;
  apply: (next: string) => void;
  readOnly: boolean;
}
