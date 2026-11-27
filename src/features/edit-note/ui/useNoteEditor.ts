import { useCallback, useEffect, useRef, useState } from 'react';
import { Annotation, ChangeSet, EditorState, type Extension, type StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { api, type NoteChange, type NoteFile } from '@/shared/api';
import { editorExtensions, readOnly, readOnlyCompartment, type EditorOptions } from '../model/editor';
import { imageSrc } from '../model/images';
import { reading, readingCompartment } from '../model/readingMode';
import { applyChanges, docOf } from '../model/serialize';

/** Saves this long after typing stops (plus on blur, ⌘S, switching notes, closing). No timer otherwise. */
const SAVE_AFTER_MS = 1000;

/** What a save writes now: the text as read with every edit since applied. */
const textOf = (ss: { original: string; acc: ChangeSet }) => applyChanges(ss.original, ss.acc);
/** No unsaved edits: the editor matches the file as last read or saved. */
const isClean = (ss: { original: string; acc: ChangeSet; file: NoteFile | null }) =>
  !!ss.file && textOf(ss) === ss.file.text;

/** Marks the transaction that loads a new disk version into the editor (not an edit of the user's). */
const reload = Annotation.define<boolean>();

export type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed';

/** What the banner shows: the note changed on disk while there were unsaved edits, or it's gone. */
export type Conflict = { kind: 'changed'; disk: NoteFile } | { kind: 'deleted' };

export interface NoteEditorState {
  file: NoteFile | null;
  /** The note can't be opened (not in an enabled source, unreadable). */
  unavailable: boolean;
  saveState: SaveState;
  conflict: Conflict | null;
  /** The editor's text, refreshed shortly after edits (outline, compare). */
  text: string;
}

type Callbacks = Pick<EditorOptions, 'links' | 'onOpenLink' | 't'> & {
  /** T79: more extensions from another feature (requirement IDs), loaded with the note. */
  extension?: () => Promise<Extension>;
  /** T82: open notes in reading mode (read when a note loads; `effects` switches it after). */
  reading?: boolean;
};

/**
 * One CodeMirror view for the panel's lifetime; `path` swaps the note in it. Keeps the text as read plus every
 * change since (one ChangeSet), so a save rewrites only what was edited (see `serialize.ts`). Watches the open note:
 * a change on disk reloads silently when there are no unsaved edits, else raises the banner.
 */
export function useNoteEditor(host: HTMLElement | null, path: string, cb: Callbacks) {
  const [state, setState] = useState<NoteEditorState>({
    file: null,
    unavailable: false,
    saveState: 'saved',
    conflict: null,
    text: '',
  });
  const view = useRef<EditorView | null>(null);
  // The live session: kept in a ref so CodeMirror callbacks and IPC events read the current one.
  const s = useRef({
    path: '',
    file: null as NoteFile | null,
    original: '',
    acc: ChangeSet.empty(0),
    edits: 0,
    saving: null as Promise<void> | null,
    conflict: null as Conflict | null,
    timer: null as ReturnType<typeof setTimeout> | null,
    textTimer: null as ReturnType<typeof setTimeout> | null,
  });
  const cbRef = useRef(cb);
  cbRef.current = cb;

  const patch = useCallback((p: Partial<NoteEditorState>) => setState((st) => ({ ...st, ...p })), []);

  type Session = typeof s.current;

  /**
   * Saves one note's edits to its own path. A note being left (switched away from, panel closed) still saves: its
   * session keeps its path, file and edits, and only the screen state is left alone once another note is shown.
   */
  const saveSession = useCallback(
    async (ss: Session): Promise<void> => {
      const ui = (p: Partial<NoteEditorState>) => {
        if (s.current === ss) patch(p);
      };
      if (ss.timer) clearTimeout(ss.timer);
      ss.timer = null;
      // A write in flight: wait for it (it updates `file`), then save what was typed meanwhile.
      while (ss.saving) await ss.saving;
      const file = ss.file;
      if (!file || file.readOnly || ss.conflict) return;
      const text = textOf(ss);
      if (text === file.text) {
        ui({ saveState: 'saved' });
        return;
      }
      const edits = ss.edits;
      const path = ss.path;
      ui({ saveState: 'saving' });
      ss.saving = (async () => {
        const res = await api.noteWrite(path, text, file.bom, file.mtime);
        if (res.ok) {
          ss.file = { ...file, text, mtime: res.mtime };
          ui({ file: ss.file, saveState: ss.edits === edits || isClean(ss) ? 'saved' : 'unsaved' });
        } else if (res.reason === 'changed') {
          // Someone wrote first: show what's there now.
          const disk = await api.noteOpen(path);
          api.noteClose(path);
          ss.conflict = disk ? { kind: 'changed', disk } : { kind: 'deleted' };
          ui({ conflict: ss.conflict, saveState: 'unsaved' });
        } else ui({ saveState: 'failed' });
      })().finally(() => {
        ss.saving = null;
      });
      await ss.saving;
    },
    [patch],
  );

  const save = useCallback(() => saveSession(s.current), [saveSession]);

  const saveRef = useRef(save);
  saveRef.current = save;

  /** Replaces the editor's text with a disk version, touching only the lines that differ (the cursor stays put). */
  const loadText = useCallback((text: string) => {
    const v = view.current;
    if (!v) return;
    const now = v.state.doc.toString();
    const next = docOf(text).toString();
    let a = 0;
    while (a < now.length && a < next.length && now[a] === next[a]) a++;
    let b = 0;
    while (b < now.length - a && b < next.length - a && now[now.length - 1 - b] === next[next.length - 1 - b])
      b++;
    v.dispatch({
      changes: { from: a, to: now.length - b, insert: next.slice(a, next.length - b) },
      annotations: reload.of(true),
    });
    s.current.original = text;
    s.current.acc = ChangeSet.empty(v.state.doc.length);
    s.current.edits = 0;
  }, []);

  // The view: created once per host.
  useEffect(() => {
    if (!host) return;
    const v = new EditorView({
      parent: host,
      state: EditorState.create({ doc: '', extensions: [] }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
  }, [host]);

  // The note: (re)opened on path change; the previous one is saved and released first.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    let alive = true;
    const session = {
      path,
      file: null as NoteFile | null,
      original: '',
      acc: ChangeSet.empty(0),
      edits: 0,
      saving: null as Promise<void> | null,
      conflict: null as Conflict | null,
      timer: null as ReturnType<typeof setTimeout> | null,
      textTimer: null as ReturnType<typeof setTimeout> | null,
    };
    s.current = session;
    setState({ file: null, unavailable: false, saveState: 'saved', conflict: null, text: '' });

    const extensions = editorExtensions({
      links: () => cbRef.current.links(),
      t: () => cbRef.current.t(),
      onOpenLink: (t) => cbRef.current.onOpenLink(t),
      onOpenUrl: (url) => void api.noteOpenUrl(url),
      imageSrc: (target) => imageSrc(path, target),
      onSave: () => void saveRef.current(),
      onBlur: () => void saveRef.current(),
      onPasteImage: async (f) => {
        const ext = f.type.split('/')[1] ?? '';
        const rel = await api.noteAttach(path, new Uint8Array(await f.arrayBuffer()), ext);
        return rel ? `![](${rel})` : null;
      },
    });
    const listener = EditorView.updateListener.of((u) => {
      if (!u.docChanged || s.current !== session) return;
      const text = () => patch({ text: u.state.doc.toString() });
      if (session.textTimer) clearTimeout(session.textTimer);
      session.textTimer = setTimeout(text, 300);
      if (u.transactions.some((tr) => tr.annotation(reload))) return;
      for (const tr of u.transactions) if (tr.docChanged) session.acc = session.acc.compose(tr.changes);
      session.edits++;
      patch({ saveState: 'unsaved' });
      if (session.timer) clearTimeout(session.timer);
      session.timer = setTimeout(() => void saveRef.current(), SAVE_AFTER_MS);
    });

    const extra = cbRef.current.extension?.().catch((): Extension => []) ?? Promise.resolve<Extension>([]);
    void Promise.all([api.noteOpen(path), extra]).then(([file, ext]) => {
      if (!alive) {
        if (file) api.noteClose(path);
        return;
      }
      if (!file) {
        patch({ unavailable: true });
        v.setState(EditorState.create({ doc: '', extensions: readOnly(true) }));
        return;
      }
      session.file = file;
      session.original = file.text;
      const st = EditorState.create({ doc: docOf(file.text), extensions: [extensions, ext, listener] });
      session.acc = ChangeSet.empty(st.doc.length);
      v.setState(st);
      v.dispatch({
        effects: [
          readOnlyCompartment.reconfigure(readOnly(!!file.readOnly)),
          readingCompartment.reconfigure(reading(!!cbRef.current.reading)),
        ],
      });
      patch({ file, text: file.text });
      if (!file.readOnly) v.focus();
    });

    const off = api.onNoteChanged((c: NoteChange) => {
      if (s.current !== session || c.path !== path || !session.file) return;
      if ('deleted' in c) {
        session.conflict = { kind: 'deleted' };
        patch({ conflict: session.conflict });
        return;
      }
      // Our own save, or a touch with the same bytes.
      if (c.text === session.file.text) {
        session.file = { ...session.file, mtime: c.mtime, bom: c.bom };
        if (session.conflict?.kind === 'deleted') session.conflict = null;
        patch({ file: session.file, conflict: session.conflict });
        return;
      }
      if (isClean(session) && !session.saving && !session.conflict) {
        session.file = c;
        loadText(c.text);
        patch({ file: c, saveState: 'saved', text: c.text });
      } else {
        session.conflict = { kind: 'changed', disk: c };
        patch({ conflict: session.conflict });
      }
    });

    return () => {
      alive = false;
      off();
      if (session.textTimer) clearTimeout(session.textTimer);
      // Save what's left of this note (even mid-write), then stop watching (IPC keeps the order: the write lands first).
      if (session.file) void saveSession(session).finally(() => api.noteClose(path));
    };
    // `host` is in the deps so a re-created view gets the note again.
  }, [path, host, patch, loadText, saveSession]);

  const resolve = useCallback(
    (choice: 'reload' | 'keepMine') => {
      const ss = s.current;
      const c = ss.conflict;
      if (!c || !ss.file) return;
      ss.conflict = null;
      if (c.kind === 'deleted') {
        patch({ conflict: null });
        return;
      }
      if (choice === 'reload') {
        ss.file = c.disk;
        loadText(c.disk.text);
        patch({ conflict: null, file: c.disk, saveState: 'saved', text: c.disk.text });
      } else {
        // Their version becomes the base we save over.
        ss.file = { ...ss.file, text: c.disk.text, mtime: c.disk.mtime, bom: c.disk.bom };
        patch({ conflict: null, file: ss.file });
        void save();
      }
    },
    [patch, loadText, save],
  );

  const goToLine = useCallback((line: number) => {
    const v = view.current;
    if (!v || line > v.state.doc.lines) return;
    const at = v.state.doc.line(line).from;
    v.dispatch({
      selection: { anchor: at },
      effects: EditorView.scrollIntoView(at, { y: 'start', yMargin: 24 }),
    });
    v.focus();
  }, []);

  /** The editor's text right now (for compare). */
  const mine = useCallback(() => textOf(s.current), []);

  /**
   * T69: makes the text `next` (a note action, a property) as one edit of only the part that differs, so it saves
   * like typing and untouched lines keep their bytes.
   */
  const replace = useCallback((next: string) => {
    const v = view.current;
    if (!v || !s.current.file || s.current.file.readOnly) return;
    const cur = v.state.doc.toString();
    const want = docOf(next).toString();
    if (cur === want) return;
    let a = 0;
    while (a < cur.length && a < want.length && cur[a] === want[a]) a++;
    let b = 0;
    while (b < cur.length - a && b < want.length - a && cur[cur.length - 1 - b] === want[want.length - 1 - b]) b++;
    v.dispatch({ changes: { from: a, to: cur.length - b, insert: want.slice(a, want.length - b) } });
  }, []);

  /** T82: presentation-only effects (reading mode, the document header); never an edit. */
  const effects = useCallback((e: StateEffect<unknown>[]) => view.current?.dispatch({ effects: e }), []);

  return { ...state, save, resolve, goToLine, mine, replace, effects };
}
