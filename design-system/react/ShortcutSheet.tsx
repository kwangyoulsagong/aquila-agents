import { Kbd } from './Kbd';
import { Label } from './Label';

export interface ShortcutSheetGroup {
  title: string;
  rows: { id: string; label: string; keys: string[] }[];
}

/** `.c-shortcuts` — every shortcut, grouped: label on the left, its keys on the right. */
export function ShortcutSheet({ groups }: { groups: ShortcutSheetGroup[] }) {
  return (
    <div className="c-shortcuts">
      {groups.map((g) => (
        <section key={g.title} className="c-shortcuts__group">
          <Label>{g.title}</Label>
          {g.rows.map((r) => (
            <div key={r.id} className="c-shortcuts__row">
              <span className="c-shortcuts__label">{r.label}</span>
              <span className="c-shortcuts__keys">
                {r.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
