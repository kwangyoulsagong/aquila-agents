import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, EmptyState, Input, ResizeHandle, Segment, Select } from '@design-system/react';
import { api, type PickResult, type PreviewSlot, type Project, type Session } from '@/shared/api';
import { sessionTitle, useT } from '@/shared/i18n';
import { usePanelWidth } from '@/shared/lib/usePanelWidth';
import { pathsInput } from '@/features/terminal-helpers';
import { parseFigmaLink } from '@/features/figma';
import { focusSession, pasteIntoSession } from '@/entities/session';
import { buildPickPrompt } from '../model/prompt';
import { pickTarget } from '../model/pickTarget';
import {
  DEVICES,
  deviceWidth,
  useDialogOpen,
  useNativeView,
  useNav,
  useStored,
  useTargets,
  type Device,
} from '../model/usePreview';

interface Props {
  /** A local project (the workspace doesn't offer the preview for remote ones). */
  project: Project;
  /** Focused session: a picked element is pasted into it when it's Claude or Codex. */
  session?: Session;
  /** Alone in the window (T51). */
  full: boolean;
  onToggleFull: () => void;
  onClose: () => void;
}

/** `localhost:3000` → `http://localhost:3000`; anything with a scheme stays. */
const withScheme = (raw: string) => {
  const v = raw.trim();
  if (!v) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `http://${v}`;
};
/** Same page regardless of how it was written (`http://localhost:3000` vs `http://localhost:3000/`). */
const sameUrl = (a: string, b: string) => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
};
const short = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '');

/** Address field: shows the page's current address, loads what's typed on Enter. */
function Address({ value, label, onGo }: { value: string; label: string; onGo: (url: string) => void }) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    const url = withScheme(e.currentTarget.value);
    if (url) onGo(url);
  };
  return (
    <Input key={value} defaultValue={value} aria-label={label} placeholder={label} onKeyDown={onKeyDown} />
  );
}

/** One native view over a stage; the DOM under it shows only while there's nothing to show (empty, error). */
function Stage({
  slot,
  url,
  width,
  covered,
  empty,
}: {
  slot: PreviewSlot;
  url: string;
  width: number;
  /** A dialog is open over the window. */
  covered: boolean;
  empty: ReactNode;
}) {
  const t = useT();
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const nav = useNav(slot);
  const failed = !!url && !!nav?.error && !nav.loading;
  useNativeView(slot, el, url, width, covered || failed);
  return (
    <div className="c-preview__stage" ref={setEl}>
      {!url && empty}
      {failed && (
        <EmptyState
          title={t('preview.error')}
          path={nav.error}
          actions={<Button onClick={() => api.previewCommand(slot, 'reload')}>{t('preview.retry')}</Button>}
        />
      )}
    </div>
  );
}

/**
 * Right column (⌘⇧P): the project's running app in a native view, with device widths and Select mode — click an
 * element and its selector, text, style, component and a screenshot are pasted into the focused Claude/Codex tab.
 * Designer layout (Figma on): Figma under the app.
 */
export default function PreviewPanel({ project, session, full, onToggleFull, onClose }: Props) {
  const t = useT();
  const targets = useTargets(project.id);
  const [url, setUrl] = useStored(`aquila.preview.url.${project.id}`);
  const [figmaUrl, setFigmaUrl] = useStored(`aquila.preview.figma.${project.id}`);
  const [deviceRaw, setDevice] = useStored('aquila.preview.device', 'fit');
  const device: Device = (DEVICES as readonly string[]).includes(deviceRaw) ? (deviceRaw as Device) : 'fit';
  const [designerRaw, setDesigner] = useStored('aquila.preview.designer');
  const designer = !!project.figma && designerRaw === '1';
  const covered = useDialogOpen();
  const width = usePanelWidth('aquila.panel.preview');
  const nav = useNav('app');
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // First dev server found becomes the address when there's none yet — or when the remembered address itself no
  // longer answers (a server restarted on another port) and a different one was found since. A failed link inside
  // the page is not a reason to leave it.
  const failed = !!nav?.error && !nav.loading;
  const addressFailed = failed && !!nav?.errorUrl && sameUrl(nav.errorUrl, url);
  useEffect(() => {
    if (targets[0] && (!url || (addressFailed && !sameUrl(targets[0], url)))) setUrl(targets[0]);
  }, [url, targets, addressFailed, setUrl]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Leaving Select mode with the panel (closed, or another project).
  useEffect(() => () => api.previewPickCancel('app'), [project.id]);

  const target = pickTarget(session);
  const targetName = target.kind === 'none' ? '' : sessionTitle(t, target.session);

  const deliver = (pick: PickResult) => {
    const prompt = buildPickPrompt(pick, {
      intro: t('preview.prompt.intro'),
      page: t('preview.prompt.page'),
      element: t('preview.prompt.element'),
      component: t('preview.prompt.component'),
      text: t('preview.prompt.text'),
      attrs: t('preview.prompt.attrs'),
      size: t('preview.prompt.size'),
      styles: t('preview.prompt.styles'),
      screenshot: t('preview.prompt.screenshot'),
    });
    // Designer layout with a Figma frame open (T34): the agent compares the pick with the design's own screenshot.
    const design = designer ? parseFigmaLink(figmaUrl) : null;
    // Before "screenshot follows", which must stay last (the image is pasted right after it).
    const lines = prompt.split('\n');
    if (design)
      lines.splice(pick.imagePath ? -1 : lines.length, 0, t('figma.prompt.pickDesign', { url: design.url }));
    const text = lines.join('\n');
    // Two pastes: a paste that is only an image path is what Claude / Codex attach as an image.
    const image = pick.imagePath ? pathsInput([pick.imagePath]) : '';
    // Read the status at delivery time: the tab may have hit a prompt while the user was picking.
    const now = pickTarget(session);
    if (now.kind === 'paste' && pasteIntoSession(now.session.id, `${text}\n`)) {
      if (image) pasteIntoSession(now.session.id, image);
      focusSession(now.session.id);
      setNotice(t('preview.pick.pasted', { name: sessionTitle(t, now.session) }));
      return;
    }
    api.copyText(pick.imagePath ? `${text}\n${pick.imagePath}` : text);
    if (now.kind === 'busy') {
      // Show the question it's waiting on; the user answers first, then pastes.
      focusSession(now.session.id);
      setNotice(t('preview.pick.busy', { name: sessionTitle(t, now.session) }));
      return;
    }
    setNotice(t('preview.pick.copied'));
  };

  const pick = async () => {
    if (picking) {
      api.previewPickCancel('app');
      return;
    }
    setPicking(true);
    setNotice(t('preview.pick.hint'));
    try {
      const result = await api.previewPick('app');
      setNotice(null);
      if (result) deliver(result);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setPicking(false);
    }
  };

  const ready = !!url && !!nav && !nav.error && !nav.loading;
  const deviceOptions = DEVICES.map((d) => ({ value: d, label: d === 'fit' ? t('preview.device.fit') : d }));

  return (
    <aside
      className={`c-panel ${full ? 'c-panel--full' : 'c-panel--wide'} c-preview`}
      {...(full ? {} : width.props)}
      aria-label={t('preview.title')}
    >
      {!full && <ResizeHandle onChange={width.onChange} onReset={width.onReset} label={t('action.resizePanel')} />}
      <div className="c-panel__head">
        <span>{t('preview.title')}</span>
        {nav?.title && (
          <span className="c-row__meta" title={nav.title}>
            {nav.title}
          </span>
        )}
        <div className="c-panel__actions">
          {project.figma && (
            <Button
              variant="ghost"
              aria-pressed={designer}
              onClick={() => setDesigner(designer ? '' : '1')}
              title={t('preview.designerHint')}
            >
              {t('preview.designer')}
            </Button>
          )}
          <Button
            variant="ghost"
            icon
            disabled={!ready}
            onClick={() => api.previewCommand('app', 'browser')}
            title={t('preview.openBrowser')}
            aria-label={t('preview.openBrowser')}
          >
            ↗
          </Button>
          <Button
            variant="ghost"
            icon
            aria-pressed={full}
            onClick={onToggleFull}
            title={full ? t('preview.full.exit') : t('preview.full.enter')}
            aria-label={full ? t('preview.full.exit') : t('preview.full.enter')}
          >
            ⛶
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
      <div className="c-panel__bar">
        <Button
          variant="ghost"
          icon
          disabled={!nav?.canGoBack}
          onClick={() => api.previewCommand('app', 'back')}
          title={t('preview.back')}
          aria-label={t('preview.back')}
        >
          ‹
        </Button>
        <Button
          variant="ghost"
          icon
          disabled={!url}
          onClick={() => api.previewCommand('app', 'reload')}
          title={t('preview.reload')}
          aria-label={t('preview.reload')}
        >
          ↻
        </Button>
        <Address value={(failed && nav?.errorUrl) || nav?.url || url} label={t('preview.address')} onGo={setUrl} />
        {targets.length > 0 && (
          <Select
            aria-label={t('preview.targets')}
            title={t('preview.targets')}
            value={targets.includes(url) ? url : ''}
            onChange={(v) => v && setUrl(v)}
            options={[
              ...(targets.includes(url) ? [] : [{ value: '', label: t('preview.targets') }]),
              ...targets.map((u) => ({ value: u, label: short(u) })),
            ]}
          />
        )}
      </div>
      <div className="c-panel__bar">
        <Segment label={t('preview.device')} options={deviceOptions} value={device} onChange={setDevice} />
        <div className="c-panel__bar-end">
          <Button
            variant="ghost"
            icon
            disabled={!ready}
            onClick={() => api.previewCommand('app', 'devtools')}
            title={t('preview.devtools')}
            aria-label={t('preview.devtools')}
          >
            {'{}'}
          </Button>
          <span className="c-row__meta" title={t('preview.pick.targetHint')}>
            {target.kind === 'none'
              ? t('preview.pick.toClipboard')
              : target.kind === 'busy'
                ? t('preview.pick.toBusy', { name: targetName })
                : t('preview.pick.to', { name: targetName })}
          </span>
          <Button
            variant={picking ? 'primary' : 'default'}
            aria-pressed={picking}
            disabled={!ready && !picking}
            onClick={() => void pick()}
          >
            {picking ? t('preview.pick.cancel') : t('preview.pick')}
          </Button>
        </div>
      </div>
      {notice && (
        <div className="c-panel__note" role="status">
          {notice}
        </div>
      )}
      <div className="c-preview__body">
        <Stage
          slot="app"
          url={url}
          width={deviceWidth(device)}
          covered={covered}
          empty={<EmptyState title={t('preview.empty')}>{t('preview.emptyHint')}</EmptyState>}
        />
        {designer && (
          <>
            <div className="c-panel__bar">
              <Address value={figmaUrl} label={t('preview.figmaAddress')} onGo={setFigmaUrl} />
            </div>
            <Stage
              slot="figma"
              url={figmaUrl}
              width={0}
              covered={covered}
              empty={<EmptyState title={t('preview.figmaEmpty')} />}
            />
          </>
        )}
      </div>
    </aside>
  );
}
