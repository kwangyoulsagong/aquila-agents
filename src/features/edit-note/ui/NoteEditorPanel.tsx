import { useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  EditorBanner,
  EditorCompare,
  EditorItem,
  EditorSection,
  EmptyState,
  NoteEditor,
  ResizeHandle,
} from '@design-system/react';
import { api, type GraphSnapshot, type GraphStatus } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { usePanelWidth } from '@/shared/lib/usePanelWidth';
import { DiffView } from '@/entities/diff';
import { useGraphData } from '@/entities/note';
import { linkOptions, linksTo, nodeOfPath, outline, resolveLink } from '../model/links';
import { lineDiff } from '../model/lineDiff';
import { useNoteEditor } from './useNoteEditor';
import { HandleWithClaude } from './HandleWithClaude';

export interface NoteEditorPanelProps {
  /** Absolute path of the note (a `.md` in an enabled source). */
  path: string;
  full: boolean;
  onToggleFull: () => void;
  onClose: () => void;
  /** Open another note here (a link, a backlink). */
  onOpenNote: (path: string) => void;
  /** T68: the note's suggested links, under the mentions (the page passes them in from another feature). */
  renderLinks?: (p: {
    nodeId: string | undefined;
    snapshot: GraphSnapshot | null;
    status: GraphStatus | null;
  }) => ReactNode;
  /** T69: companion tabs / note actions above the text, typed properties beside it (from another feature). */
  renderTop?: (p: NoteSlotProps) => ReactNode;
  renderSide?: (p: NoteSlotProps) => ReactNode;
  /** T69: a `[[link]]` to a missing note can be created (where new notes go is the source's setting). */
  onCreateNote?: (name: string, sourceId: string | undefined) => void;
  /** T70: "Handle with Claude" opens a Claude tab with the note (the page's). */
  onClaude?: (prompt: string, projectId: string | undefined) => void;
}

/** What a slot gets: the note, its text right now, and a way to change it as one edit (saved like typing). */
export interface NoteSlotProps {
  path: string;
  text: () => string;
  /** The editor's text after edits settle (re-render trigger). */
  version: string;
  apply: (next: string) => void;
  readOnly: boolean;
}

const fileName = (p: string) => p.split(/[/\\]/).pop() ?? p;

/**
 * Right panel and full window: one Markdown note in CodeMirror with live preview (T67). Saved byte for byte on
 * blur, ⌘S and a second after typing stops. Outline, backlinks and unlinked mentions beside it; a banner when the
 * file changes on disk under unsaved edits.
 */
export default function NoteEditorPanel({
  path,
  full,
  onToggleFull,
  onClose,
  onOpenNote,
  renderLinks,
  renderTop,
  renderSide,
  onCreateNote,
  onClaude,
}: NoteEditorPanelProps) {
  const t = useT();
  const width = usePanelWidth('aquila.panel.note');
  const { status, snapshot } = useGraphData();
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [sideOn, setSide] = useState<boolean | null>(null);
  const [comparing, setComparing] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const node = nodeOfPath(snapshot, path);

  const ed = useNoteEditor(host, path, {
    links: () => linkOptions(snapshot, path),
    onOpenLink: (target) => {
      const to = resolveLink(snapshot, target, node?.sourceId);
      if (to?.path) {
        setMissing(null);
        onOpenNote(to.path);
      } else setMissing(target);
    },
  });

  const headings = useMemo(() => outline(ed.text), [ed.text]);
  const { backlinks, mentions } = useMemo(() => linksTo(snapshot, node?.id), [snapshot, node?.id]);
  // The side column is on by default in full window, off in the narrower panel.
  const side = sideOn ?? full;
  const conflict = ed.conflict;
  const diff = useMemo(
    () =>
      comparing && conflict?.kind === 'changed'
        ? lineDiff(fileName(path), conflict.disk.text, ed.mine())
        : null,
    // `ed.text` stands for "the editor changed".
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comparing, conflict, path, ed.text],
  );

  const slot: NoteSlotProps = {
    path,
    text: ed.mine,
    version: ed.text,
    apply: ed.replace,
    readOnly: !ed.file || !!ed.file.readOnly,
  };
  const title = node?.label ?? fileName(path).replace(/\.md$/i, '');
  const saveLabel =
    ed.saveState === 'saving'
      ? t('note.saving')
      : ed.saveState === 'unsaved'
        ? t('note.unsaved')
        : ed.saveState === 'failed'
          ? t('note.saveFailed')
          : t('note.saved');

  let banner = null;
  if (conflict?.kind === 'changed')
    banner = (
      <EditorBanner
        tone="warn"
        actions={
          <>
            <Button variant="ghost" aria-pressed={comparing} onClick={() => setComparing((c) => !c)}>
              {comparing ? t('note.compareHide') : t('note.compare')}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setComparing(false);
                ed.resolve('keepMine');
              }}
            >
              {t('note.keepMine')}
            </Button>
            <Button
              onClick={() => {
                setComparing(false);
                ed.resolve('reload');
              }}
            >
              {t('note.reload')}
            </Button>
          </>
        }
      >
        {t('note.changed')}
      </EditorBanner>
    );
  else if (conflict?.kind === 'deleted')
    banner = (
      <EditorBanner tone="warn" actions={<Button onClick={onClose}>{t('action.close')}</Button>}>
        {t('note.deleted')}
      </EditorBanner>
    );
  else if (ed.file?.readOnly) banner = <EditorBanner>{t('note.readOnly')}</EditorBanner>;
  else if (missing)
    banner = (
      <EditorBanner
        actions={
          <>
            {onCreateNote && (
              <Button
                variant="ghost"
                onClick={() => {
                  setMissing(null);
                  onCreateNote(missing, node?.sourceId);
                }}
              >
                {t('note.createMissing')}
              </Button>
            )}
            <Button variant="ghost" icon onClick={() => setMissing(null)} aria-label={t('action.close')}>
              ×
            </Button>
          </>
        }
      >
        {t('note.missingLink', { name: missing })}
      </EditorBanner>
    );

  return (
    <aside
      className={`c-panel ${full ? 'c-panel--full' : 'c-panel--wide'}`}
      {...(full ? {} : width.props)}
      aria-label={t('note.title')}
    >
      {!full && (
        <ResizeHandle onChange={width.onChange} onReset={width.onReset} label={t('action.resizePanel')} />
      )}
      <div className="c-panel__head">
        <span title={path}>{title}</span>
        {ed.file && (
          <span className="c-row__meta" data-fixed data-save={ed.saveState}>
            {saveLabel}
          </span>
        )}
        <div className="c-panel__actions">
          {onClaude && ed.file && <HandleWithClaude notePath={path} onClaude={onClaude} />}
          <Button
            variant="ghost"
            icon
            aria-pressed={side}
            onClick={() => setSide(!side)}
            title={t('note.side')}
            aria-label={t('note.side')}
          >
            ☰
          </Button>
          <Button
            variant="ghost"
            icon
            onClick={() => void api.graphOpenNote(path)}
            title={t('note.openDefault')}
            aria-label={t('note.openDefault')}
          >
            ↗
          </Button>
          <Button
            variant="ghost"
            icon
            aria-pressed={full}
            onClick={onToggleFull}
            title={full ? t('note.full.exit') : t('note.full.enter')}
            aria-label={full ? t('note.full.exit') : t('note.full.enter')}
          >
            ⤢
          </Button>
          <Button
            variant="ghost"
            icon
            onClick={onClose}
            title={t('action.close')}
            aria-label={t('action.close')}
          >
            ×
          </Button>
        </div>
      </div>
      {/* The editor stays mounted while a note can't be opened, so the next note opens in the same view. */}
      {ed.unavailable && <EmptyState title={t('note.unavailable')} path={path} />}
      <NoteEditor
        hostRef={setHost}
        hidden={ed.unavailable}
        top={
          <>
            {renderTop?.(slot)}
            {banner}
            {comparing && conflict?.kind === 'changed' && (
              <EditorCompare>
                {diff ? <DiffView files={[diff]} /> : <EmptyState title={t('note.compareTooLarge')} />}
              </EditorCompare>
            )}
          </>
        }
        side={
          side ? (
            <>
              <EditorSection title={t('note.outline')} empty={t('note.outlineEmpty')}>
                {headings.map((h) => (
                  <EditorItem
                    key={`${h.line}`}
                    label={h.text}
                    level={h.level - 1}
                    onClick={() => ed.goToLine(h.line)}
                  />
                ))}
              </EditorSection>
              <EditorSection title={t('note.backlinks')} empty={t('note.none')}>
                {backlinks.map((b) => (
                  <EditorItem
                    key={b.id}
                    label={b.label}
                    detail={b.detail}
                    title={b.path}
                    onClick={() => onOpenNote(b.path)}
                  />
                ))}
              </EditorSection>
              <EditorSection title={t('note.mentions')} empty={t('note.none')}>
                {mentions.map((m) => (
                  <EditorItem key={m.id} label={m.label} title={m.path} onClick={() => onOpenNote(m.path)} />
                ))}
              </EditorSection>
              {renderSide?.(slot)}
              {renderLinks?.({ nodeId: node?.id, snapshot, status })}
            </>
          ) : undefined
        }
      />
    </aside>
  );
}
