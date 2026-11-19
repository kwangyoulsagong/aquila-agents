import type { IBuffer, IBufferCell } from '@xterm/xterm';
import { findMatches, type TargetKind } from '../model/quickSelect';

/** A run of cells on one screen row (a match that wraps has one per row). */
export interface Segment {
  row: number;
  col: number;
  /** Width in cells. */
  cells: number;
}

export interface ScreenTarget {
  kind: TargetKind;
  text: string;
  segments: Segment[];
}

/** One logical line on screen (wrapped rows joined) and the cell under each UTF-16 unit of its text. */
interface Line {
  text: string;
  at: { row: number; col: number; width: number }[];
}

/** Visible rows as logical lines. Wide characters (Hangul, emoji) take two cells but one place in the text. */
function visibleLines(buffer: IBuffer, rows: number, cols: number): Line[] {
  const lines: Line[] = [];
  let cell: IBufferCell | undefined;
  for (let r = 0; r < rows; r++) {
    const line = buffer.getLine(buffer.viewportY + r);
    if (!line) continue;
    const prev = lines[lines.length - 1];
    const cur: Line = line.isWrapped && prev && r > 0 ? prev : { text: '', at: [] };
    if (cur !== prev) lines.push(cur);
    for (let c = 0; c < cols; c++) {
      cell = line.getCell(c, cell);
      if (!cell) break;
      const width = cell.getWidth();
      if (width === 0) continue; // second half of a wide character
      const chars = cell.getChars() || ' ';
      for (let i = 0; i < chars.length; i++) {
        cur.text += chars[i];
        cur.at.push({ row: r, col: c, width });
      }
    }
  }
  return lines;
}

/** URLs, paths and hashes on screen, top to bottom, with where each one is drawn. */
export function screenTargets(buffer: IBuffer, rows: number, cols: number): ScreenTarget[] {
  const out: ScreenTarget[] = [];
  for (const line of visibleLines(buffer, rows, cols)) {
    for (const m of findMatches(line.text)) {
      const segments: Segment[] = [];
      for (let i = m.start; i < m.end; i++) {
        const p = line.at[i];
        if (!p) break;
        const last = segments[segments.length - 1];
        if (last && last.row === p.row && last.col + last.cells === p.col) last.cells += p.width;
        else if (!last || last.row !== p.row || p.col >= last.col + last.cells)
          segments.push({ row: p.row, col: p.col, cells: p.width });
      }
      if (segments.length) out.push({ kind: m.kind, text: m.text, segments });
    }
  }
  return out;
}
