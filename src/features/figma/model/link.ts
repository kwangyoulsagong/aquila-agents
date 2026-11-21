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
 * The prompt a chip types. Claude has Claude in Chrome built in; Codex doesn't, so it gets the MCP-only prompt.
 * The Chrome pass catches what the MCP data misses (states, real fonts, images, overflow, widths).
 */
export function chipPrompt(
  chip: Chip,
  kind: 'claude' | 'codex',
  prompt: string,
  chromeCheck: string,
): string {
  return chipInput(chip.chrome && kind === 'claude' ? `${prompt} ${chromeCheck}` : prompt);
}
