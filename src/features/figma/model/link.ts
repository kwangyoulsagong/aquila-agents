/** What a Figma link points at; decides which prompt chips make sense. */
export type FigmaLinkKind = 'design' | 'board';

export interface FigmaLink {
  /** The link as found (the MCP tools take it as is). */
  url: string;
  kind: FigmaLinkKind;
  fileKey: string;
  /** `node-id` from the query (`1-2`), when the link points at a frame. */
  nodeId?: string;
}

// design / file (legacy) / proto / make → a design file; board → FigJam. Slides and sites aren't offered.
const LINK = /https?:\/\/(?:www\.)?figma\.com\/(design|file|proto|make|board)\/([A-Za-z0-9]+)[^\s'"<>)\]]*/;

/** The first Figma file link in `text` (a paste), or null. */
export function parseFigmaLink(text: string): FigmaLink | null {
  const m = LINK.exec(text);
  if (!m) return null;
  const url = m[0].replace(/[.,;:!?]+$/, '');
  let nodeId: string | undefined;
  try {
    nodeId = new URL(url).searchParams.get('node-id') ?? undefined;
  } catch {
    // the regex already matched a URL shape; a bad query just means no node
  }
  return { url, kind: m[1] === 'board' ? 'board' : 'design', fileKey: m[2], nodeId };
}

/** Design = look, compare, plan; Build = write code. */
export type ChipGroup = 'design' | 'build';
export type ChipId = 'compare' | 'flow' | 'comments' | 'implement' | 'assets';

export interface Chip {
  id: ChipId;
  group: ChipGroup;
  /** Claude tabs: after the MCP pass, check the frame and the running app side by side in Claude in Chrome. */
  chrome?: boolean;
}

/** Chips for a link, Design group first. FigJam boards have flows and comments, no frames to build. */
export function chipsFor(link: FigmaLink): Chip[] {
  if (link.kind === 'board')
    return [
      { id: 'flow', group: 'design' },
      { id: 'comments', group: 'design' },
    ];
  return [
    { id: 'compare', group: 'design', chrome: true },
    { id: 'comments', group: 'design' },
    { id: 'implement', group: 'build', chrome: true },
    { id: 'assets', group: 'build' },
  ];
}

/**
 * What a chip types after the link that's already in the input: a space, then the prompt. No Enter — the user reads
 * it, adds to it and sends.
 */
export const chipInput = (prompt: string): string => ` ${prompt.replace(/\s*\n\s*/g, ' ').trim()}`;

/**
 * The prompt a chip types: a short intent sentence (T55; the tool-level detail is in the chip's tooltip). Claude has
 * Claude in Chrome built in; Codex doesn't, so only Claude gets the Chrome check. `link`: the link is no longer on the
 * input line (it was already sent), so the prompt carries it.
 */
export function chipPrompt(
  chip: Chip,
  kind: 'claude' | 'codex',
  prompt: string,
  chromeCheck: string,
  link?: string,
): string {
  const text = chipInput(chip.chrome && kind === 'claude' ? `${prompt} ${chromeCheck}` : prompt);
  return link ? `${link}${text}` : text;
}

/** What the user has on the CLI's input line, rebuilt from the keys sent to the pty (T55). */
export interface InputLine {
  text: string;
  /** Inside a bracketed paste: Enter there is part of the pasted text, not a send. */
  inPaste: boolean;
}

export const EMPTY_LINE: InputLine = { text: '', inPaste: false };

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
// Other escape sequences (arrows, function keys, focus reports) don't change what we track.
// eslint-disable-next-line no-control-regex
const ESCAPE = /^\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O.|.)?/;

/**
 * Feeds one `onData` chunk into the line: printable text is added, Backspace removes, Ctrl+U / Ctrl+C clear, Enter
 * (outside a paste) sends. Arrows and other cursor moves are ignored, so the line is a best guess: good enough to
 * find a link and to tell whether a sent line had it.
 */
export function feedLine(line: InputLine, data: string): { line: InputLine; sent: string[] } {
  let { text, inPaste } = line;
  const sent: string[] = [];
  let i = 0;
  while (i < data.length) {
    if (data.startsWith(PASTE_START, i)) {
      inPaste = true;
      i += PASTE_START.length;
      continue;
    }
    if (data.startsWith(PASTE_END, i)) {
      inPaste = false;
      i += PASTE_END.length;
      continue;
    }
    const ch = data[i];
    if (ch === '\x1b') {
      i += ESCAPE.exec(data.slice(i))?.[0].length ?? 1;
      continue;
    }
    i += 1;
    if (ch === '\r' || ch === '\n') {
      if (inPaste) text += '\n';
      else {
        sent.push(text);
        text = '';
      }
    } else if (ch === '\x7f' || ch === '\b') text = text.slice(0, -1);
    else if (ch === '\x15' || ch === '\x03') text = '';
    else if (ch >= ' ') text += ch;
  }
  return { line: { text, inPaste }, sent };
}

/** A Figma link dragged in as a link or as text. */
export function droppedFigmaLink(data: Pick<DataTransfer, 'getData'>): FigmaLink | null {
  return parseFigmaLink(data.getData('text/uri-list') || data.getData('text/plain'));
}
