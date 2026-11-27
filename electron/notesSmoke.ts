// Smoke checks for the note features T77–T82 (blocks, properties + table, requirement IDs, change review, "What is
// this?", the document look). Driven like the rest of smoke: real key / mouse / IME input into the hidden window,
// exact file bytes checked on disk. All on small notes written to a throwaway folder added as one note source.
import fs from 'node:fs';
import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import type { Config } from '../src/shared/api/types';
import { translator } from '../src/shared/i18n/dictionary';

type Translate = ReturnType<typeof translator>;
type Modifiers = Electron.InputEvent['modifiers'];

/** What smoke.ts lends these checks (kept there, shared with the other checks). */
export interface NoteSmokeHelpers {
  press: (win: BrowserWindow, keyCode: string, modifiers: Modifiers) => void;
  paletteRun: (win: BrowserWindow, label: string, prefix?: boolean) => Promise<boolean>;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CRLF = (lines: string[]) => lines.join('\r\n');
const LF = (lines: string[]) => lines.join('\n');
const FENCE = '`'.repeat(3);

/** The fixture notes (file name → bytes). Titles are unique, so ⌘O finds each by its title. */
const FIXTURES: Record<string, string> = {
  'blocks.md': CRLF([
    '# Blocks smoke',
    '',
    'First paragraph.',
    '',
    '- one',
    '- two',
    '- three',
    '',
    '## Heading two',
    '',
    '1. alpha',
    '2. beta',
    '3. gamma',
    '',
    'Last paragraph.',
    '',
  ]),
  'props.md': LF([
    '---',
    'status: draft',
    'owner: mina',
    '---',
    '# Props smoke',
    '',
    'Body of the props note.',
    '',
  ]),
  'Remember me spec.md': LF([
    '---',
    'id: FE-REQ-901',
    'status: done',
    'owner: jun',
    '---',
    '# Remember me spec',
    '',
    'Keep returning users signed in for 30 days.',
    '',
  ]),
  'dup-a.md': LF([
    '---',
    'id: FE-REQ-902',
    'status: done',
    'owner: ara',
    '---',
    '# Duplicate A',
    '',
    'One.',
    '',
  ]),
  'dup-b.md': LF(['---', 'id: FE-REQ-902', 'status: draft', '---', '# Duplicate B', '', 'Two.', '']),
  'mentions.md': LF([
    '# ID mentions',
    '',
    'Implements FE-REQ-901 as written in the Remember me spec.',
    '',
    'Also FE-REQ-902 and FE-REQ-999.',
    '',
  ]),
  'review.md': LF([
    '# Review smoke',
    '',
    'alpha',
    'beta',
    'gamma',
    'delta',
    'epsilon',
    'zeta',
    'eta',
    'theta',
    'iota',
    'kappa',
    'lambda',
    'mu',
    '',
  ]),
  'look.md': LF([
    '# Look smoke',
    '',
    '> [!NOTE]',
    '> A callout card.',
    '',
    '| a | b |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    `${FENCE}ts`,
    'const x = 1;',
    FENCE,
    '',
    '- [ ] tick me',
    '',
  ]),
};

/** The open editor's CodeMirror view (CodeMirror keeps it on its DOM tile). */
const VIEW = `document.querySelector('.c-editor .cm-content').cmTile.root.view`;

interface Ctx {
  win: BrowserWindow;
  t: Translate;
  outDir: string;
  dir: string;
  h: NoteSmokeHelpers;
  js: <T>(code: string) => Promise<T>;
  until: (code: string, ms?: number) => Promise<boolean>;
  file: (name: string) => string;
  read: (name: string) => string;
  fileUntil: (name: string, want: string, ms?: number) => Promise<boolean>;
  open: (query: string, title: string) => Promise<boolean>;
  shot: (name: string) => Promise<string>;
  mouse: (type: 'mouseMove' | 'mouseDown' | 'mouseUp', x: number, y: number, modifiers?: Modifiers) => void;
  cdp: (method: string, params?: object) => Promise<unknown>;
  noteAside: string;
}

/**
 * T77–T82 on one throwaway note source: each feature its own check (below), each ending with a screenshot
 * `dist/smoke-<feature>.png` and a `[smoke] <feature>: …` line. Returns an error or null.
 */
export async function checkNoteFeatures(
  win: BrowserWindow,
  config: Config,
  outDir: string,
  h: NoteSmokeHelpers,
): Promise<string | null> {
  const t = translator(config.language);
  const js = <T>(code: string) => win.webContents.executeJavaScript(code) as Promise<T>;
  const until = async (code: string, ms = 8000) => {
    for (let i = 0; i < ms / 100; i++) {
      if (await js<boolean>(code)) return true;
      await wait(100);
    }
    return false;
  };
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'aquila-smoke-notefeat-'));
  for (const [name, text] of Object.entries(FIXTURES)) fs.writeFileSync(path.join(dir, name), text);
  const file = (name: string) => path.join(dir, name);
  const read = (name: string) => fs.readFileSync(file(name), 'utf8');
  const noteAside = `aside[aria-label=${JSON.stringify(t('note.title'))}]`;
  const dbg = win.webContents.debugger;
  const ctx: Ctx = {
    win,
    t,
    outDir,
    dir,
    h,
    js,
    until,
    file,
    read,
    noteAside,
    fileUntil: async (name, want, ms = 5000) => {
      for (let i = 0; i < ms / 100; i++) {
        if (read(name) === want) return true;
        await wait(100);
      }
      return false;
    },
    open: async (query, title) => {
      h.press(win, 'O', ['meta']);
      if (!(await until(`!!document.querySelector('.c-palette[open]')`))) return false;
      await js(`(() => {
        const input = document.querySelector('.c-palette[open] input');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, ${JSON.stringify(query)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await wait(250);
      h.press(win, 'Enter', []);
      return until(
        `document.querySelector('${noteAside} .c-panel__head > span')?.textContent === ${JSON.stringify(title)} && !!document.querySelector('.c-editor .cm-content')?.textContent.includes(${JSON.stringify(title)})`,
      );
    },
    shot: async (name) => {
      await wait(300);
      const out = path.join(outDir, `smoke-${name}.png`);
      fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
      return out;
    },
    mouse: (type, x, y, modifiers = []) =>
      win.webContents.sendInputEvent({
        type,
        x: Math.round(x),
        y: Math.round(y),
        modifiers,
        ...(type === 'mouseMove' ? {} : { button: 'left' as const, clickCount: 1 }),
      }),
    cdp: (method, params = {}) => {
      if (!dbg.isAttached()) dbg.attach('1.3');
      return dbg.sendCommand(method, params);
    },
  };
  let sourceId = '';
  try {
    const st = await js<{ sources: { id: string; path: string }[] }>(
      `window.aquila.graphAddSource(${JSON.stringify(dir)})`,
    );
    sourceId = st.sources.find((x) => x.path === dir || x.path.endsWith(path.basename(dir)))?.id ?? '';
    if (!sourceId) return 'notes: the fixture source was not added';
    const paths = JSON.stringify(Object.keys(FIXTURES).map(file));
    if (
      !(await until(
        `window.aquila.graphSnapshot().then((g) => ${paths}.every((p) => g.nodes.some((n) => n.path === p)))`,
        15_000,
      ))
    )
      return 'notes: the fixture notes never reached the index';
    await ctx.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });

    for (const check of [
      checkBlocks,
      checkProperties,
      checkIds,
      checkReview,
      checkWhatIsThis,
      checkLook,
      checkExplorer,
    ]) {
      const error = await check(ctx, sourceId);
      if (error) return error;
    }
    return null;
  } finally {
    // Back to editing (reading mode is remembered) and close the editor.
    await js(`localStorage.setItem('aquila.note.reading', '0')`).catch(() => undefined);
    await js(`localStorage.setItem('aquila.note.explorer', '0')`).catch(() => undefined);
    await js(`document.querySelector('${noteAside} .c-panel__actions button:last-child')?.click()`).catch(
      () => undefined,
    );
    await wait(300);
    if (sourceId)
      await js(`window.aquila.graphRemoveSource(${JSON.stringify(sourceId)})`).catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Puts the cursor at `at` (an offset, or the first offset of `find` plus `plus`) and focuses the editor. */
async function cursor(c: Ctx, find: string | null, plus = 0): Promise<boolean> {
  return c.js<boolean>(`(() => {
    const v = ${VIEW};
    const s = v.state.doc.toString();
    const i = ${find === null ? 's.length' : `s.indexOf(${JSON.stringify(find)})`};
    if (i < 0) return false;
    v.focus();
    v.dispatch({ selection: { anchor: i + ${plus} }, scrollIntoView: true });
    return true;
  })()`);
}

/** Screen point (CSS px) of the text `find` in the editor: its left edge + `dx`, at the line's middle (or top + dy). */
async function pointOf(
  c: Ctx,
  find: string,
  o: { plus?: number; dx?: number; dy?: number } = {},
): Promise<{ x: number; y: number; top: number; bottom: number } | null> {
  return c.js(`(() => {
    const v = ${VIEW};
    const i = v.state.doc.toString().indexOf(${JSON.stringify(find)});
    if (i < 0) return null;
    const r = v.coordsAtPos(i + ${o.plus ?? 0}, 1);
    if (!r) return null;
    return { x: r.left + ${o.dx ?? 2}, y: ${o.dy === undefined ? '(r.top + r.bottom) / 2' : `r.top + ${o.dy}`}, top: r.top, bottom: r.bottom };
  })()`);
}

/**
 * T77: ⌥⇧↓ moves a list item one down; the ⋮⋮ handle drags a heading above a paragraph (pointer events); `/` +
 * Korean through the IME (an Enter inside the composition must not pick) and `/todo` + Enter insert `- [ ] `. Every
 * step changes exactly the moved / typed bytes; CRLF stays.
 */
async function checkBlocks(c: Ctx): Promise<string | null> {
  const name = 'blocks.md';
  if (!(await c.open('Blocks smoke', 'Blocks smoke'))) return 'blocks: ⌘O did not open the note';
  let want = c.read(name);

  // ⌥⇧↓ on "- one": it trades places with "- two" (the splice: one line out, one line in).
  if (!(await cursor(c, '- one', 3))) return 'blocks: no "- one" line';
  c.h.press(c.win, 'Down', ['alt', 'shift']);
  want = want.replace('- one\r\n- two\r\n', '- two\r\n- one\r\n');
  if (!(await c.fileUntil(name, want)))
    return `blocks: ⌥⇧↓ saved ${JSON.stringify(c.read(name))}, expected ${JSON.stringify(want)}`;

  // ⌥⇧↓ in a numbered list: the item moves and only the number tokens are rewritten.
  if (!(await cursor(c, '1. alpha', 4))) return 'blocks: no "1. alpha" line';
  c.h.press(c.win, 'Down', ['alt', 'shift']);
  want = want.replace('1. alpha\r\n2. beta\r\n', '1. beta\r\n2. alpha\r\n');
  if (!(await c.fileUntil(name, want)))
    return `blocks: ⌥⇧↓ in a numbered list saved ${JSON.stringify(c.read(name))}, expected ${JSON.stringify(want)}`;

  // The handle: hover "## Heading two", press its ⋮⋮, drag above "First paragraph.", release.
  await c.js(`document.activeElement?.blur?.()`);
  const heading = await pointOf(c, '## Heading two', { plus: 3, dx: 8 });
  if (!heading) return 'blocks: the heading is not on screen';
  c.mouse('mouseMove', heading.x, heading.y);
  c.mouse('mouseMove', heading.x + 4, heading.y);
  if (
    !(await c.until(
      `(() => { const b = document.querySelector('.c-editor__handle'); return !!b && !b.hidden && b.getBoundingClientRect().width > 0; })()`,
      3000,
    ))
  )
    return 'blocks: hovering a block showed no ⋮⋮ handle';
  await wait(150);
  const handle = await c.js<{ x: number; y: number }>(`(() => {
    const r = document.querySelector('.c-editor__handle').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  const target = await pointOf(c, 'First paragraph.', { dy: 2 });
  if (!target) return 'blocks: "First paragraph." is not on screen';
  c.mouse('mouseMove', handle.x, handle.y);
  c.mouse('mouseDown', handle.x, handle.y);
  for (let i = 1; i <= 8; i++) {
    c.mouse('mouseMove', handle.x, handle.y + ((target.y - handle.y) * i) / 8, ['leftbuttondown']);
    await wait(30);
  }
  const dropShown = await c.js<boolean>(`!document.querySelector('.c-editor__drop')?.hidden`);
  c.mouse('mouseUp', handle.x, target.y);
  want = want
    .replace('\r\n\r\n## Heading two', '')
    .replace('# Blocks smoke\r\n\r\n', '# Blocks smoke\r\n\r\n## Heading two\r\n\r\n');
  if (!(await c.fileUntil(name, want)))
    return `blocks: the handle drag (drop line ${dropShown}) saved ${JSON.stringify(c.read(name))}, expected ${JSON.stringify(want)}`;

  // `/` then Korean through the IME on the blank line under the heading: an Enter that belongs to the composition
  // does not pick; once committed, Enter picks "할 일" → `- [ ] ` in place of `/할`.
  if (!(await cursor(c, '## Heading two\n', '## Heading two\n'.length))) return 'blocks: no blank line';
  c.win.webContents.insertText('/');
  for (const text of ['ㅎ', '하', '할'])
    await c.cdp('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
  await wait(300);
  for (const type of ['rawKeyDown', 'keyUp'])
    await c.cdp('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 229,
      nativeVirtualKeyCode: 229,
    });
  await wait(200);
  const composing = await c.js<string>(`${VIEW}.state.doc.toString()`);
  if (composing.includes('- [ ] ')) return 'blocks: Enter during the IME composition picked a slash item';
  await c.cdp('Input.insertText', { text: '할' });
  const tip = `[...document.querySelectorAll('.cm-tooltip-autocomplete li')]`;
  if (
    !(await c.until(
      `${tip}[0]?.textContent.includes(${JSON.stringify(c.t('note.slash.task'))}) ?? false`,
      3000,
    ))
  )
    return `blocks: "/할" did not list "할 일" first (${await c.js<string>(`${tip}.map((l) => l.textContent).join(' | ')`)})`;
  await wait(150);
  c.h.press(c.win, 'Enter', []);
  want = want.replace('## Heading two\r\n\r\n', '## Heading two\r\n- [ ] \r\n');
  if (!(await c.fileUntil(name, want)))
    return `blocks: "/할" + Enter saved ${JSON.stringify(c.read(name))}, expected ${JSON.stringify(want)}`;

  // `/todo` at the end (the English alias) + Enter.
  if (!(await cursor(c, null))) return 'blocks: no end of the note';
  c.win.webContents.insertText('/todo');
  if (
    !(await c.until(
      `${tip}[0]?.textContent.includes(${JSON.stringify(c.t('note.slash.task'))}) ?? false`,
      3000,
    ))
  )
    return 'blocks: "/todo" did not list the to-do item first';
  await wait(150);
  c.h.press(c.win, 'Enter', []);
  want = `${want}- [ ] `;
  if (!(await c.fileUntil(name, want)))
    return `blocks: "/todo" + Enter saved ${JSON.stringify(c.read(name))}, expected ${JSON.stringify(want)}`;
  const out = await c.shot('blocks');
  console.log(
    `[smoke] blocks: ⌥⇧↓ moved one list item (numbered list renumbered), ⋮⋮ drag moved the heading (drop line ${dropShown}), "/할" (IME Enter ignored) and "/todo" wrote "- [ ] ", CRLF kept, screenshot: ${out}`,
  );
  return null;
}

/**
 * T78: the properties panel shows the note's frontmatter; a value edited there changes only that line. ⌘K → Table
 * view lists the source's notes, sorts by a column, filters by a status chip, and a cell edit changes only that key.
 */
async function checkProperties(c: Ctx): Promise<string | null> {
  const name = 'props.md';
  if (!(await c.open('Props smoke', 'Props smoke'))) return 'properties: ⌘O did not open the note';
  const props = `document.querySelector('${c.noteAside} .c-props')`;
  if (!(await c.until(`!!${props}`))) return 'properties: no properties panel above the note';
  // Unfolded (it remembers being folded).
  await c.js(`(() => {
    const t = ${props}.querySelector('.c-props__toggle');
    if (t && t.getAttribute('aria-expanded') === 'false') t.click();
  })()`);
  const rows = `[...${props}.querySelectorAll('.c-props__row')]`;
  if (
    !(await c.until(
      `(() => { const r = ${rows}.map((x) => x.querySelector('.c-props__key')?.textContent + '=' + (x.querySelector('input')?.value ?? '')); return r.includes('status=draft') && r.includes('owner=mina'); })()`,
    ))
  )
    return `properties: the panel does not show status / owner (${await c.js<string>(`${rows}.map((x) => x.textContent).join(' | ')`)})`;

  // Edit "owner" in the panel: Enter commits.
  const before = c.read(name);
  const ok = await c.js<boolean>(`(() => {
    const row = ${rows}.find((x) => x.querySelector('.c-props__key')?.textContent === 'owner');
    const input = row?.querySelector('input');
    if (!input) return false;
    input.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, 'kai');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) return 'properties: no input for "owner"';
  await wait(100);
  c.h.press(c.win, 'Enter', []);
  let want = before.replace('owner: mina\n', 'owner: kai\n');
  if (!(await c.fileUntil(name, want)))
    return `properties: the panel edit saved ${JSON.stringify(c.read(name))}, expected ${JSON.stringify(want)}`;
  const panelShot = await c.shot('properties');

  // ⌘K → Table view: the source's rows.
  if (!(await c.h.paletteRun(c.win, c.t('table.menu'))))
    return `properties: palette has no "${c.t('table.menu')}"`;
  const titles = `[...document.querySelectorAll('.c-ntable .c-ntable__row .c-ntable__open')].map((b) => b.textContent)`;
  if (!(await c.until(`${titles}.length === ${Object.keys(FIXTURES).length}`, 8000)))
    return `properties: the table lists ${JSON.stringify(await c.js(titles))}`;
  const headers = `[...document.querySelectorAll('.c-ntable__th')].map((x) => x.textContent)`;
  const col = async (key: string) => (await c.js<string[]>(headers)).findIndex((x) => x.startsWith(key));
  const ownerAt = await col('owner');
  if (ownerAt < 0) return `properties: no "owner" column (${JSON.stringify(await c.js(headers))})`;
  // Sort by owner: those with one first, ascending.
  await c.js(
    `document.querySelectorAll('.c-ntable__th')[${ownerAt}].querySelector('.c-ntable__sort').click()`,
  );
  const sorted = ['Duplicate A', 'Remember me spec', 'Props smoke'];
  if (
    !(await c.until(
      `JSON.stringify(${titles}.slice(0, 3)) === ${JSON.stringify(JSON.stringify(sorted))}`,
      3000,
    ))
  )
    return `properties: sort by owner gave ${JSON.stringify(await c.js(titles))}`;
  // Status chip "done": only the two done notes.
  const chip = `[...document.querySelectorAll('.c-ntable__chip')].find((b) => b.textContent.startsWith('done'))`;
  if (!(await c.until(`!!${chip}`))) return 'properties: no "done" status chip';
  await c.js(`${chip}.click()`);
  if (
    !(await c.until(
      `JSON.stringify(${titles}) === ${JSON.stringify(JSON.stringify(['Duplicate A', 'Remember me spec']))}`,
      3000,
    ))
  )
    return `properties: the "done" chip left ${JSON.stringify(await c.js(titles))}`;
  // Edit Remember me spec's owner in its cell.
  const specBefore = c.read('Remember me spec.md');
  const cell = `[...document.querySelectorAll('.c-ntable .c-ntable__row')].find((r) => r.querySelector('.c-ntable__open')?.textContent === 'Remember me spec').children[${ownerAt}]`;
  await c.js(`${cell}.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
  if (!(await c.until(`!!document.querySelector('.c-ntable__input')`, 3000)))
    return 'properties: double-click opened no cell editor';
  await c.js(`(() => {
    const input = document.querySelector('.c-ntable__input');
    input.focus();
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(input, 'sora');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await wait(100);
  c.h.press(c.win, 'Enter', []);
  want = specBefore.replace('owner: jun\n', 'owner: sora\n');
  if (!(await c.fileUntil('Remember me spec.md', want)))
    return `properties: the cell edit saved ${JSON.stringify(c.read('Remember me spec.md'))}`;
  const tableShot = await c.shot('table');
  c.h.press(c.win, 'Escape', []);
  if (!(await c.until(`!document.querySelector('.c-ntable')`, 3000))) {
    await c.js(
      `document.querySelector('.c-modal [aria-label=${JSON.stringify(c.t('action.close'))}]')?.click()`,
    );
    if (!(await c.until(`!document.querySelector('.c-ntable')`, 3000)))
      return 'properties: the table did not close';
  }
  console.log(
    `[smoke] properties: panel shows frontmatter, owner edit changed one line; table ${Object.keys(FIXTURES).length} rows, sort by owner, "done" chip, cell edit changed one line, screenshots: ${panelShot}, ${tableShot}`,
  );
  return null;
}

/**
 * T79: FE-REQ-901 (frontmatter id) is marked defined, FE-REQ-902 (two notes) duplicate, FE-REQ-999 unknown; hover
 * shows the defining note's title; ⌘-click opens it; "Link" on its unlinked mention (confirm) writes exactly one
 * `[[Remember me spec]]` into the mentioning note.
 */
async function checkIds(c: Ctx): Promise<string | null> {
  if (!(await c.open('ID mentions', 'ID mentions'))) return 'ids: ⌘O did not open the note';
  const mark = (id: string) => `document.querySelector('.c-editor .c-noteid[data-id=${JSON.stringify(id)}]')`;
  if (
    !(await c.until(
      `${mark('FE-REQ-901')}?.dataset.state === 'defined' && ${mark('FE-REQ-902')}?.dataset.state === 'duplicate' && ${mark('FE-REQ-999')}?.dataset.state === 'unknown'`,
    ))
  )
    return `ids: marks ${await c.js<string>(`JSON.stringify([...document.querySelectorAll('.c-editor .c-noteid')].map((m) => m.dataset.id + ':' + m.dataset.state))`)}`;

  // Hover FE-REQ-901: the card names the defining note.
  const at = await c.js<{ x: number; y: number }>(`(() => {
    const r = ${mark('FE-REQ-901')}.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  c.mouse('mouseMove', at.x - 3, at.y);
  c.mouse('mouseMove', at.x, at.y);
  if (
    !(await c.until(
      `document.querySelector('.c-noteid-tip .c-noteid-tip__title')?.textContent === 'Remember me spec'`,
      4000,
    ))
  )
    return 'ids: hovering FE-REQ-901 showed no card with "Remember me spec"';
  const out = await c.shot('ids');

  // ⌘-click: the defining note opens.
  c.mouse('mouseDown', at.x, at.y, ['meta']);
  c.mouse('mouseUp', at.x, at.y, ['meta']);
  if (
    !(await c.until(
      `document.querySelector('${c.noteAside} .c-panel__head > span')?.textContent === 'Remember me spec'`,
    ))
  )
    return 'ids: ⌘-click on FE-REQ-901 did not open its note';
  c.mouse('mouseMove', 2, 2);

  // Its unlinked mention (the ID mentions note says "Remember me spec") → Link → confirm → one [[link]].
  const sideOn = await c.js<boolean>(`(() => {
    const b = document.querySelector('${c.noteAside} .c-panel__actions button[aria-label=${JSON.stringify(c.t('note.side'))}]');
    if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
    return !!b;
  })()`);
  if (!sideOn) return 'ids: no side column button';
  const row = `[...document.querySelectorAll('${c.noteAside} .c-noteid-row')].find((r) => r.textContent.includes('ID mentions'))`;
  if (!(await c.until(`!!${row}`))) return 'ids: "ID mentions" is not listed as an unlinked mention';
  const before = c.read('mentions.md');
  await c.js(
    `[...${row}.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(c.t('mentions.link'))}).click()`,
  );
  const write = `[...document.querySelectorAll('${c.noteAside} .c-noteid-note button')].find((b) => b.textContent === ${JSON.stringify(c.t('mentions.write'))})`;
  if (!(await c.until(`!!${write}`, 3000))) return 'ids: "Link" asked for no confirmation';
  if (c.read('mentions.md') !== before) return 'ids: "Link" wrote before the confirmation';
  await c.js(`${write}.click()`);
  const want = before.replace('the Remember me spec.', 'the [[Remember me spec]].');
  if (!(await c.fileUntil('mentions.md', want)))
    return `ids: "Link" wrote ${JSON.stringify(c.read('mentions.md'))}, expected ${JSON.stringify(want)}`;
  // "Referenced in · FE-REQ-901" (the full ID, prefix segments kept) lists the mentioning note; a click opens it.
  const refs = `document.querySelector('${c.noteAside} .c-editor__section[aria-label=${JSON.stringify(`${c.t('noteId.section')} · FE-REQ-901`)}]')`;
  if (!(await c.until(`!!${refs}`)))
    return `ids: no "${c.t('noteId.section')} · FE-REQ-901" section (${await c.js<string>(`[...document.querySelectorAll('${c.noteAside} .c-editor__section')].map((x) => x.getAttribute('aria-label')).join(' | ')`)})`;
  const ref = `[...${refs}.querySelectorAll('.c-editor__item')].find((x) => x.textContent.includes('ID mentions'))`;
  if (!(await c.until(`!!${ref}`))) return 'ids: "Referenced in" does not list "ID mentions"';
  await c.js(`${ref}.click()`);
  if (
    !(await c.until(
      `document.querySelector('${c.noteAside} .c-panel__head > span')?.textContent === 'ID mentions'`,
    ))
  )
    return 'ids: a "Referenced in" row did not open its note';
  console.log(
    `[smoke] ids: FE-REQ-901 defined / 902 duplicate / 999 unknown, hover card "Remember me spec", ⌘-click opened it, Link (confirmed) wrote one [[Remember me spec]], "Referenced in · FE-REQ-901" opens the mention, screenshot: ${out}`,
  );
  return null;
}

/**
 * T80: a note opened (seen copy recorded) then written from outside shows the review bar with +2 −1; Review shows the
 * diff; Revert hunk (confirmed) restores exactly that hunk; Mark as seen hides the bar.
 */
async function checkReview(c: Ctx): Promise<string | null> {
  const name = 'review.md';
  if (!(await c.open('Review smoke', 'Review smoke'))) return 'review: ⌘O did not open the note';
  await wait(1000); // the seen copy is written as the note opens
  const seen = c.read(name);
  const outside = seen.replace('\nbeta\n', '\nBETA\n').replace('\nmu\n', '\nmu\nnu\n');
  fs.writeFileSync(c.file(name), outside);
  const counts = `document.querySelector('${c.noteAside} .c-review__counts')`;
  if (
    !(await c.until(
      `${counts}?.querySelector('.c-review__add')?.textContent === '+2' && ${counts}?.querySelector('.c-review__del')?.textContent === '−1'`,
    ))
  )
    return `review: no "+2 −1" bar after the outside write (${await c.js<string>(`${counts}?.textContent ?? 'none'`)})`;
  const button = (label: string, scope = c.noteAside) =>
    c.js<boolean>(`(() => {
      const b = [...document.querySelectorAll('${scope} button')].find((x) => x.textContent === ${JSON.stringify(label)});
      b?.click();
      return !!b;
    })()`);
  if (!(await button(c.t('noteReview.review')))) return 'review: the bar has no Review';
  if (
    !(await c.until(
      `document.querySelectorAll('${c.noteAside} .c-editor__compare .c-diff__actions').length === 2`,
    ))
  )
    return 'review: Review shows no diff with two hunks';
  const out = await c.shot('note-review');
  // The first hunk's Revert, then the confirmation's Revert.
  await c.js(`document.querySelector('${c.noteAside} .c-editor__compare .c-diff__actions button').click()`);
  if (!(await c.until(`!!document.querySelector('${c.noteAside} .c-review__confirm')`, 3000)))
    return 'review: Revert hunk asked for no confirmation';
  await c.js(
    `[...document.querySelector('${c.noteAside} .c-review__confirm').parentElement.querySelectorAll('button')].find((b) => b.textContent === ${JSON.stringify(c.t('noteReview.revert'))}).click()`,
  );
  const want = outside.replace('\nBETA\n', '\nbeta\n');
  if (!(await c.fileUntil(name, want)))
    return `review: Revert hunk saved ${JSON.stringify(c.read(name))}, expected ${JSON.stringify(want)}`;
  if (
    !(await c.until(
      `${counts}?.querySelector('.c-review__add')?.textContent === '+1' && ${counts}?.querySelector('.c-review__del')?.textContent === '−0'`,
    ))
  )
    return `review: after the revert the bar reads ${await c.js<string>(`${counts}?.textContent ?? 'none'`)}`;
  if (!(await button(c.t('noteReview.markSeen')))) return 'review: the bar has no Mark as seen';
  if (!(await c.until(`!${counts}`, 3000))) return 'review: Mark as seen left the bar';
  console.log(
    `[smoke] review: outside write → "+2 −1" bar, diff with 2 hunks, Revert hunk (confirmed) restored one line exactly, Mark as seen hid it, screenshot: ${out}`,
  );
  return null;
}

/**
 * T81: ⌘K → What is this?, an email pasted: the preview keeps only Subject / From / Date of its headers and shows the
 * size; Ask Claude (the canned smoke reply, no model) fills the card; the spec sharing its ID is related; Save as note
 * writes a note with `type: brief`.
 */
async function checkWhatIsThis(c: Ctx, sourceId: string): Promise<string | null> {
  if (!(await c.h.paletteRun(c.win, c.t('brief.action'))))
    return `brief: palette has no "${c.t('brief.action')}"`;
  const dlg = `document.querySelector('.c-dialog[open] .c-brief')`;
  if (!(await c.until(`!!${dlg}`))) return 'brief: the dialog did not open';
  const email = [
    'From: Mina Park <mina@example.com>',
    'To: team@example.com',
    'Date: Tue, 24 Nov 2026 10:00:00 +0900',
    'Subject: Remember me on the login screen',
    'Message-ID: <smoke-123@example.com>',
    'Received: from mail.example.com',
    '',
    'Hi team, FE-REQ-901 asks for a remember me checkbox on the login screen.',
    'Tokens last 30 days.',
  ].join('\n');
  await c.js(`(() => {
    const ta = document.querySelector('.c-dialog[open] textarea');
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(ta, ${JSON.stringify(email)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const preview = `document.querySelector('.c-dialog[open] .c-brief__preview')?.textContent ?? ''`;
  if (!(await c.until(`(${preview}).includes('Subject: Remember me')`)))
    return 'brief: no preview of what is sent';
  const shown = await c.js<string>(preview);
  for (const kept of ['Subject:', 'From:', 'Date:', 'FE-REQ-901'])
    if (!shown.includes(kept)) return `brief: the preview lost "${kept}": ${JSON.stringify(shown)}`;
  for (const cut of ['To: team', 'Message-ID', 'Received:'])
    if (shown.includes(cut)) return `brief: the preview still has "${cut}": ${JSON.stringify(shown)}`;
  const suffix = c.t('brief.chars', { n: '' });
  const size = await c.js<boolean>(
    `[...document.querySelectorAll('.c-dialog[open] .c-brief__meta span')].some((s) => /^[\\d,.]+/.test(s.textContent) && s.textContent.endsWith(${JSON.stringify(suffix)}))`,
  );
  if (!size) return 'brief: the preview shows no size';
  const button = (label: string) =>
    c.js<boolean>(`(() => {
      const b = [...document.querySelectorAll('.c-dialog[open] button')].find((x) => x.textContent === ${JSON.stringify(label)} && !x.disabled);
      b?.click();
      return !!b;
    })()`);
  if (!(await button(c.t('brief.run')))) return 'brief: no enabled "Ask Claude"';
  const card = `document.querySelector('.c-dialog[open] .c-brief__card')`;
  if (
    !(await c.until(
      `(${card}?.textContent ?? '').includes('Aquila Agents') && ${card}.querySelectorAll('.c-brief__bullets li').length >= 3`,
      15_000,
    ))
  )
    return 'brief: the canned reply did not fill the card';
  if (
    !(await c.until(
      `[...document.querySelectorAll('.c-dialog[open] .c-brief__rel-title')].some((x) => x.textContent === 'Remember me spec')`,
    ))
  )
    return 'brief: the spec with the same ID is not among the related notes';
  // Save into the fixture source.
  await c.js(`(() => {
    const s = [...document.querySelectorAll('.c-dialog[open] select')].find((x) => [...x.options].some((o) => o.value === ${JSON.stringify(sourceId)}));
    if (!s) return;
    const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    set.call(s, ${JSON.stringify(sourceId)});
    s.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait(100);
  const out = await c.shot('brief');
  const before = new Set(fs.readdirSync(c.dir, { recursive: true }).map(String));
  if (!(await button(c.t('brief.save')))) return 'brief: no "Save as note"';
  const saved = c.t('brief.saved').split('{path}')[0]!;
  if (
    !(await c.until(
      `[...document.querySelectorAll('.c-dialog[open] .c-brief__meta-label')].some((x) => x.textContent.startsWith(${JSON.stringify(saved)}))`,
    ))
  )
    return 'brief: Save as note reported nothing';
  const added = fs
    .readdirSync(c.dir, { recursive: true })
    .map(String)
    .filter((f) => !before.has(f) && f.endsWith('.md'));
  if (added.length !== 1) return `brief: Save as note added ${JSON.stringify(added)}`;
  const note = fs.readFileSync(path.join(c.dir, added[0]!), 'utf8');
  if (!/^---\n(?:.*\n)*?type: brief\n(?:.*\n)*?---\n/.test(note))
    return `brief: the saved note has no "type: brief" frontmatter: ${JSON.stringify(note.slice(0, 200))}`;
  await button(c.t('brief.close'));
  if (!(await c.until(`!${dlg}`, 3000))) return 'brief: the dialog did not close';
  // The editor head has it too.
  const head = await c.js<boolean>(`(() => {
    const b = [...document.querySelectorAll('${c.noteAside} .c-panel__actions button')].find((x) => x.textContent === ${JSON.stringify(c.t('brief.button'))});
    b?.click();
    return !!b;
  })()`);
  if (!head) return 'brief: the editor head has no "What is this?" button';
  if (!(await c.until(`!!${dlg}`, 3000))) return 'brief: the editor head button opened no dialog';
  await button(c.t('brief.close'));
  if (!(await c.until(`!${dlg}`, 3000))) return 'brief: the dialog did not close';
  console.log(
    `[smoke] brief: email headers cut to Subject / From / Date, size shown, canned reply → card, related "Remember me spec", saved ${added[0]} (type: brief), editor head button opens it, screenshot: ${out}`,
  );
  return null;
}

/**
 * T82: the document header, callout / table / code cards; ⌘E switches to reading mode (typing, Backspace and ⌥⇧↓
 * change nothing; a checkbox still writes `[x]`) and back.
 */
async function checkLook(c: Ctx): Promise<string | null> {
  const name = 'look.md';
  if (!(await c.open('Look smoke', 'Look smoke'))) return 'look: ⌘O did not open the note';
  const has = (sel: string) => `!!document.querySelector('.c-editor ${sel}')`;
  for (const sel of ['.cm-md-dochead', '.cm-md-callout', '.cm-md-table', '.cm-md-codehead'])
    if (!(await c.until(has(sel), 4000))) return `look: no ${sel} in the editor`;
  if (await c.js<boolean>(has('.cm-reading'))) return 'look: opened in reading mode';
  const editShot = await c.shot('look');
  const before = c.read(name);

  await c.js(`${VIEW}.focus()`);
  c.h.press(c.win, 'E', ['meta']);
  if (!(await c.until(has('.cm-reading'), 3000))) return 'look: ⌘E did not switch to reading mode';
  await c.js(`${VIEW}.focus()`);
  c.win.webContents.insertText('Q');
  c.h.press(c.win, 'Backspace', []);
  c.h.press(c.win, 'Down', ['alt', 'shift']);
  await wait(1500);
  if (c.read(name) !== before)
    return `look: typing in reading mode changed the file: ${JSON.stringify(before)} → ${JSON.stringify(c.read(name))}`;
  await c.js(`(() => {
    const b = document.querySelector('.c-editor .cm-md-checkbox');
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  })()`);
  const want = before.replace('- [ ] tick me', '- [x] tick me');
  if (!(await c.fileUntil(name, want)))
    return `look: a checkbox in reading mode saved ${JSON.stringify(c.read(name))}`;
  const readShot = await c.shot('look-reading');
  await c.js(`${VIEW}.focus()`);
  c.h.press(c.win, 'E', ['meta']);
  if (!(await c.until(`!${has('.cm-reading')}`, 3000))) return 'look: ⌘E did not switch back to editing';
  console.log(
    `[smoke] look: header, callout / table / code cards; ⌘E reading mode (typing / Backspace / ⌥⇧↓ ignored, checkbox wrote [x]) and back, screenshots: ${editShot}, ${readShot}`,
  );
  return null;
}
/** T83: a second throwaway source with nested folders, a `newNotes` template and a note linking to a spec. */
const EXPLORER_FIXTURES: Record<string, string> = {
  '.aquila-vault.json': JSON.stringify({
    v: 1,
    templates: [
      {
        id: 'spec',
        name: 'Spec',
        folder: 'inbox',
        file: '{{title}}.md',
        body: '---\nstatus: todo\n---\n# {{title}}\n',
      },
    ],
    newNotes: 'spec',
  }),
  'specs/in-progress/FE-REQ-029.md': '# Explorer twenty-nine\n',
  'specs/in-progress/FE-REQ-030.md': '# Explorer thirty\n\nBody.\n',
  'specs/done/FE-REQ-001.md': '# Explorer one\n',
  'notes/linker.md': CRLF([
    '# Explorer linker',
    '',
    'See [[FE-REQ-030|the spec]] and [x](../specs/in-progress/FE-REQ-030.md).',
    '',
  ]),
};

/**
 * T83: ⌘⇧O opens the editor panel with the explorer and no note; the tree lists the nested folders with counts;
 * New folder; New note suggests the next ID and uses the template; F2 renames the open note → the link question →
 * exactly the two link spans rewritten (CRLF kept) and the editor follows; a drag onto a folder moves it (editor
 * follows, links fixed again); ⌘Z undoes the move (links left as they are on "Leave them"); the filter + Enter opens
 * a match; Trash removes a folder (to the macOS Trash, not emptied).
 */
async function checkExplorer(c: Ctx): Promise<string | null> {
  const t = c.t;
  const dir = fs.mkdtempSync(path.join(app.getPath('temp'), 'aquila-smoke-explorer-'));
  const at = (rel: string) => path.join(dir, ...rel.split('/'));
  for (const [rel, text] of Object.entries(EXPLORER_FIXTURES)) {
    fs.mkdirSync(path.dirname(at(rel)), { recursive: true });
    fs.writeFileSync(at(rel), text);
  }
  const read = (rel: string) => (fs.existsSync(at(rel)) ? fs.readFileSync(at(rel), 'utf8') : null);
  const poll = async (ok: () => boolean, ms = 5000) => {
    for (let i = 0; i < ms / 100; i++) {
      if (ok()) return true;
      await wait(100);
    }
    return false;
  };
  const ROW = (rel: string) =>
    `[...document.querySelectorAll('.c-explorer .c-tree__row')].filter((r) => r.dataset.rel === ${JSON.stringify(rel)}).pop()`;
  const head = (p: string) =>
    `document.querySelector('${c.noteAside} .c-panel__head > span')?.getAttribute('title') === ${JSON.stringify(p)}`;
  const inputValue = (v: string) =>
    `document.activeElement?.classList.contains('c-tree__input') && document.activeElement.value === ${JSON.stringify(v)}`;
  const linkQuestion = `[...document.querySelectorAll('.c-dialog[open]')].some((d) => d.textContent.includes('notes/linker.md'))`;
  const dialogButton = (label: string) =>
    c.js<boolean>(`(() => {
      const b = [...document.querySelectorAll('.c-dialog[open] button')].find((x) => x.textContent === ${JSON.stringify(label)});
      b?.click();
      return !!b;
    })()`);
  const focusTree = () => c.js(`document.querySelector('.c-explorer .c-tree').focus()`);
  const rowAction = (rel: string, label: string) =>
    c.js<boolean>(`(() => {
      const b = [...(${ROW(rel)}?.querySelectorAll('button') ?? [])].find((x) => x.getAttribute('aria-label') === ${JSON.stringify(label)});
      b?.click();
      return !!b;
    })()`);
  let sourceId = '';
  try {
    const st = await c.js<{ sources: { id: string; path: string }[] }>(
      `window.aquila.graphAddSource(${JSON.stringify(dir)})`,
    );
    sourceId = st.sources.find((x) => x.path === dir || x.path.endsWith(path.basename(dir)))?.id ?? '';
    if (!sourceId) return 'explorer: the fixture source was not added';
    const linker = at('notes/linker.md');
    const spec = at('specs/in-progress/FE-REQ-030.md');
    if (
      !(await c.until(
        `window.aquila.graphSnapshot({ notesOnly: true }).then((g) => {
          const id = (p) => g.nodes.find((n) => n.path === p)?.id;
          return g.edges.some((e) => e.source === id(${JSON.stringify(linker)}) && e.target === id(${JSON.stringify(spec)}));
        })`,
        15_000,
      ))
    )
      return 'explorer: the index never linked notes/linker.md to FE-REQ-030';

    // No note open: ⌘⇧O opens the panel with the explorer and the empty state.
    await c.js(`document.querySelector('${c.noteAside} .c-panel__actions button:last-child')?.click()`);
    await c.until(`!document.querySelector('${c.noteAside}')`, 3000);
    c.h.press(c.win, 'O', ['meta', 'shift']);
    if (!(await c.until(`!!document.querySelector('${c.noteAside} .c-explorer')`)))
      return 'explorer: ⌘⇧O did not open the panel with the explorer';
    if (
      !(await c.until(
        `document.querySelector('${c.noteAside} .c-empty__title')?.textContent === ${JSON.stringify(t('explorer.empty'))}`,
        3000,
      ))
    )
      return 'explorer: no "pick a note" empty state';
    await c.js(`(() => {
      const s = document.querySelector('.c-explorer select[aria-label=${JSON.stringify(t('explorer.source'))}]');
      if (!s) return;
      const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      set.call(s, ${JSON.stringify(sourceId)});
      s.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    if (
      !(await c.until(
        `${ROW('specs')}?.querySelector('.c-tree__count')?.textContent === '3' && !!${ROW('notes')}`,
      ))
    )
      return 'explorer: the tree does not list "specs" (3 notes) and "notes"';
    await c.js(`${ROW('specs')}.click()`);
    if (!(await c.until(`!!${ROW('specs/in-progress')} && !!${ROW('specs/done')}`, 3000)))
      return 'explorer: clicking "specs" did not open it';
    await c.js(`${ROW('specs/in-progress')}.click()`);
    if (!(await c.until(`!!${ROW('specs/in-progress/FE-REQ-030.md')}`, 3000)))
      return 'explorer: clicking "in-progress" did not open it';

    // New folder.
    if (!(await rowAction('specs', t('explorer.newFolder'))))
      return 'explorer: no New folder button on "specs"';
    if (!(await c.until(inputValue(''), 3000))) return 'explorer: New folder showed no name field';
    c.win.webContents.insertText('archive');
    c.h.press(c.win, 'Enter', []);
    if (!(await poll(() => !!fs.statSync(at('specs/archive'), { throwIfNoEntry: false })?.isDirectory())))
      return 'explorer: New folder did not make specs/archive';
    if (!(await c.until(`!!${ROW('specs/archive')}`, 3000)))
      return 'explorer: the new empty folder is not listed';

    // New note: the next ID suggested, the template applied, the note opens.
    if (!(await rowAction('specs/in-progress', t('explorer.newNote'))))
      return 'explorer: no New note button on "in-progress"';
    if (!(await c.until(inputValue('FE-REQ-031'), 3000)))
      return 'explorer: New note did not suggest FE-REQ-031';
    c.h.press(c.win, 'Enter', []);
    const created = 'specs/in-progress/FE-REQ-031.md';
    if (!(await poll(() => read(created) === '---\nstatus: todo\n---\n# FE-REQ-031\n')))
      return `explorer: the new note is ${JSON.stringify(read(created))}, not the template`;
    if (!(await c.until(head(at(created)), 5000))) return 'explorer: the new note did not open';

    // Open FE-REQ-030, F2 → rename → fix links.
    await c.js(`${ROW('specs/in-progress/FE-REQ-030.md')}.click()`);
    if (
      !(await c.until(
        `${head(spec)} && !!document.querySelector('.c-editor .cm-content')?.textContent.includes('Explorer thirty')`,
      ))
    )
      return 'explorer: clicking FE-REQ-030 did not open it';
    await wait(400);
    await focusTree();
    c.h.press(c.win, 'F2', []);
    if (!(await c.until(inputValue('FE-REQ-030'), 3000))) return 'explorer: F2 showed no rename field';
    c.win.webContents.insertText('FE-REQ-030 login');
    c.h.press(c.win, 'Enter', []);
    const renamed = 'specs/in-progress/FE-REQ-030 login.md';
    if (
      !(await poll(
        () =>
          read(renamed) === '# Explorer thirty\n\nBody.\n' &&
          read('specs/in-progress/FE-REQ-030.md') === null,
      ))
    )
      return 'explorer: F2 did not rename FE-REQ-030';
    if (!(await c.until(linkQuestion))) return 'explorer: no "fix links?" question after the rename';
    if (read('notes/linker.md') !== EXPLORER_FIXTURES['notes/linker.md'])
      return 'explorer: links were rewritten before the yes';
    const linksShot = await c.shot('explorer-links');
    if (!(await dialogButton(t('explorer.links.fix')))) return 'explorer: no "Fix links" button';
    const want1 = CRLF([
      '# Explorer linker',
      '',
      'See [[FE-REQ-030 login|the spec]] and [x](../specs/in-progress/FE-REQ-030%20login.md).',
      '',
    ]);
    if (!(await poll(() => read('notes/linker.md') === want1)))
      return `explorer: links after the rename: ${JSON.stringify(read('notes/linker.md'))}`;
    if (!(await c.until(head(at(renamed)), 3000))) return 'explorer: the editor did not follow the rename';

    // Drag the open note onto specs/done.
    const box = (rel: string) =>
      c.js<{ x: number; y: number } | null>(`(() => {
        const r = ${ROW(rel)}?.getBoundingClientRect();
        return r ? { x: r.left + 48, y: r.top + r.height / 2 } : null;
      })()`);
    if (!(await c.until(`!!${ROW(renamed)}`, 3000))) return 'explorer: the renamed note is not in the tree';
    const from = await box(renamed);
    const to = await box('specs/done');
    if (!from || !to) return 'explorer: rows to drag are not on screen';
    c.mouse('mouseMove', from.x, from.y);
    c.mouse('mouseDown', from.x, from.y);
    for (let i = 1; i <= 8; i++) {
      c.mouse('mouseMove', from.x, from.y + ((to.y - from.y) * i) / 8, ['leftbuttondown']);
      await wait(30);
    }
    const dropShown = await c.js<boolean>(`!!${ROW('specs/done')}?.hasAttribute('data-drop')`);
    c.mouse('mouseUp', to.x, to.y);
    const movedRel = 'specs/done/FE-REQ-030 login.md';
    if (!(await poll(() => read(movedRel) !== null && read(renamed) === null)))
      return `explorer: dragging onto specs/done did not move the note (drop target shown: ${dropShown})`;
    if (!(await c.until(linkQuestion))) return 'explorer: no "fix links?" question after the move';
    await dialogButton(t('explorer.links.fix'));
    const want2 = want1.replace('in-progress/FE-REQ-030%20login', 'done/FE-REQ-030%20login');
    if (!(await poll(() => read('notes/linker.md') === want2)))
      return `explorer: links after the move: ${JSON.stringify(read('notes/linker.md'))}`;
    if (!(await c.until(head(at(movedRel)), 3000))) return 'explorer: the editor did not follow the move';
    await wait(500);
    if (
      await c.js<boolean>(
        `!!document.querySelector('${c.noteAside}')?.textContent.includes(${JSON.stringify(t('note.deleted'))})`,
      )
    )
      return 'explorer: the editor says the moved note was deleted';

    // ⌘Z undoes the move; "Leave them" writes nothing.
    await focusTree();
    c.h.press(c.win, 'Z', ['meta']);
    if (!(await poll(() => read(renamed) !== null && read(movedRel) === null)))
      return 'explorer: ⌘Z did not undo the move';
    if (await c.until(linkQuestion, 3000)) await dialogButton(t('explorer.links.skip'));
    await wait(300);
    if (read('notes/linker.md') !== want2) return 'explorer: "Leave them" changed the links';
    if (!(await c.until(head(at(renamed)), 3000))) return 'explorer: the editor did not follow the undo';

    // Filter + Enter opens the first match.
    await c.js(`(() => {
      const input = document.querySelector('.c-explorer input[aria-label=${JSON.stringify(t('explorer.filter'))}]');
      input.focus();
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, '031');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    if (
      !(await c.until(
        `(() => { const files = [...document.querySelectorAll('.c-explorer .c-tree__row[data-kind=file]')]; return files.length === 1 && files[0].dataset.rel === ${JSON.stringify(created)}; })()`,
        3000,
      ))
    )
      return 'explorer: the filter "031" did not leave FE-REQ-031 alone';
    c.h.press(c.win, 'Enter', []);
    if (!(await c.until(head(at(created)), 3000)))
      return 'explorer: Enter in the filter did not open the match';
    const shot = await c.shot('explorer');
    await c.js(`(() => {
      const input = document.querySelector('.c-explorer input[aria-label=${JSON.stringify(t('explorer.filter'))}]');
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(input, '');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);

    // Trash a folder (asks first).
    if (!(await c.until(`!!${ROW('specs/archive')}`, 3000))) return 'explorer: specs/archive is not listed';
    await c.js(`${ROW('specs/archive')}.click()`);
    await focusTree();
    c.h.press(c.win, 'Backspace', ['meta']);
    if (!(await c.until(`!!document.querySelector('.c-dialog[open]')`, 3000)))
      return 'explorer: ⌘⌫ did not ask before the Trash';
    await dialogButton(t('explorer.delete'));
    if (!(await poll(() => !fs.existsSync(at('specs/archive')))))
      return 'explorer: specs/archive was not moved to the Trash';
    console.log(
      `[smoke] explorer: ⌘⇧O empty state, nested tree with counts, New folder, New note FE-REQ-031 from the template, F2 rename → links fixed exactly (CRLF kept), drag onto specs/done (drop target ${dropShown ? 'shown' : 'not seen'}) → editor followed, ⌘Z undo, filter + Enter, folder to the Trash; screenshots: ${shot}, ${linksShot}`,
    );
    return null;
  } finally {
    if (sourceId)
      await c.js(`window.aquila.graphRemoveSource(${JSON.stringify(sourceId)})`).catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
