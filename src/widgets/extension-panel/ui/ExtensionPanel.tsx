import { useState } from 'react';
import { Button, EmptyState, Field, MetaList, MetaRow, Range, ResizeHandle, Select } from '@design-system/react';
import { api, type ExtensionInfo } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { useDialogOpen } from '@/shared/lib/useDialogOpen';
import { usePanelWidth } from '@/shared/lib/usePanelWidth';
import { PERMISSION_KEY, pickExtension } from '../model/useExtensions';
import { useExtensionView } from '../model/useExtensionView';

interface Props {
  list: ExtensionInfo[] | null;
  /** The extension to show (null / gone → the first). */
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onClose: () => void;
}

const glyphed = (e: ExtensionInfo) => (e.glyph ? `${e.glyph}  ${e.name}` : e.name);

/**
 * Right column (T71): one user extension at a time — picker, its page in a sandboxed native view over the stage, or
 * the permission review before it's enabled. Nothing bundled: an empty folder shows "New extension".
 */
export default function ExtensionPanel({ list, selected, onSelect, onNew, onClose }: Props) {
  const t = useT();
  const width = usePanelWidth('aquila.panel.ext');
  const ext = list ? pickExtension(list, selected) : undefined;
  const running = !!ext && ext.valid && ext.enabled;

  return (
    <aside className="c-panel c-ext" {...width.props} aria-label={t('ext.title')}>
      <ResizeHandle onChange={width.onChange} onReset={width.onReset} label={t('action.resizePanel')} />
      <div className="c-panel__head">
        <span>{t('ext.title')}</span>
        <div className="c-panel__actions">
          <Button variant="ghost" onClick={onNew}>
            {t('ext.new')}
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
      {list && !ext && (
        <EmptyState
          title={t('ext.empty')}
          path="~/.aquila/extensions"
          actions={
            <>
              <Button variant="primary" onClick={onNew}>
                {t('ext.new')}
              </Button>
              <Button onClick={() => void api.extensionsOpenFolder()}>{t('ext.openFolder')}</Button>
            </>
          }
        />
      )}
      {list && ext && (
        <>
          <div className="c-panel__bar">
            {list.length > 1 ? (
              <Select
                className="c-ext__pick"
                aria-label={t('ext.pick')}
                value={ext.id}
                options={list.map((e) => ({ value: e.id, label: glyphed(e) }))}
                onChange={onSelect}
              />
            ) : (
              <span className="c-ext__name" title={ext.description}>
                {ext.icon ? (
                  <>
                    <img className="c-ext-icon" src={ext.icon} alt="" /> {ext.name}
                  </>
                ) : (
                  glyphed(ext)
                )}
              </span>
            )}
            <div className="c-panel__bar-end">
              {running && ext.permissions.includes('background') && (
                <Button
                  variant="ghost"
                  aria-pressed={ext.background}
                  title={t('ext.backgroundHint')}
                  onClick={() => void api.extensionsSetBackground(ext.id, !ext.background)}
                >
                  {t('ext.background')}
                </Button>
              )}
              {running && !ext.floating && (
                <Button
                  variant="ghost"
                  icon
                  onClick={() => void api.extensionsFloat(ext.id, true)}
                  title={t('ext.floatHint')}
                  aria-label={t('ext.float')}
                >
                  ⇱
                </Button>
              )}
              {running && (
                <Button
                  variant="ghost"
                  icon
                  onClick={() => api.extensionsReload(ext.id)}
                  title={t('ext.reload')}
                  aria-label={t('ext.reload')}
                >
                  ↻
                </Button>
              )}
              <Button
                variant="ghost"
                icon
                onClick={() => void api.extensionsOpenFolder(ext.id)}
                title={t('ext.openFolder')}
                aria-label={t('ext.openFolder')}
              >
                ⌂
              </Button>
              {running && (
                <Button onClick={() => void api.extensionsSetEnabled(ext.id, false)}>
                  {t('ext.disable')}
                </Button>
              )}
            </div>
          </div>
          {!running ? (
            <Review ext={ext} />
          ) : ext.floating ? (
            <Floating ext={ext} />
          ) : (
            <Stage key={ext.id} id={ext.id} />
          )}
        </>
      )}
    </aside>
  );
}

/** The page: a native view main lays over this box. */
function Stage({ id }: { id: string }) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const covered = useDialogOpen();
  useExtensionView(id, el, covered);
  return <div className="c-ext__stage" ref={setEl} />;
}

/** While it's in its own window: that window's transparency and always-on-top, and the way back. */
function Floating({ ext }: { ext: ExtensionInfo }) {
  const t = useT();
  const transparency = Math.round((1 - ext.opacity) * 100);
  return (
    <div className="c-panel__body c-ext__review">
      <p className="c-ext__text">{t('ext.floating')}</p>
      <Field label={t('ext.transparency', { n: String(transparency) })}>
        <Range
          label={t('ext.menuTransparency')}
          value={transparency}
          min={0}
          max={80}
          step={5}
          onChange={(n) => void api.extensionsFloatStyle(ext.id, { opacity: 1 - n / 100 })}
        />
      </Field>
      <div className="c-ext__actions">
        <Button
          variant="ghost"
          aria-pressed={ext.onTop}
          onClick={() => void api.extensionsFloatStyle(ext.id, { onTop: !ext.onTop })}
        >
          {t('ext.onTop')}
        </Button>
      </div>
      <div className="c-ext__actions">
        <Button onClick={() => void api.extensionsFloat(ext.id, true)}>{t('ext.showWindow')}</Button>
        <Button variant="primary" onClick={() => void api.extensionsFloat(ext.id, false)}>
          {t('ext.dock')}
        </Button>
      </div>
    </div>
  );
}

/** Before enabling (or when the manifest can't be used): what it is and what it may do. */
function Review({ ext }: { ext: ExtensionInfo }) {
  const t = useT();
  return (
    <div className="c-panel__body c-ext__review">
      {!ext.valid ? (
        <EmptyState
          title={t('ext.invalid')}
          path={ext.problems.join('\n')}
          actions={<Button onClick={() => api.extensionsReload(ext.id)}>{t('ext.reload')}</Button>}
        />
      ) : (
        <>
          {ext.description && <p className="c-ext__text">{ext.description}</p>}
          {ext.added ? (
            <p className="c-ext__text" data-tone="warn" role="status">
              {t('ext.permissionsChanged', {
                added: [...ext.added.permissions.map((p) => t(PERMISSION_KEY[p])), ...ext.added.network].join(', '),
              })}
            </p>
          ) : (
            <p className="c-ext__text c-ext__text--muted">{t('ext.review')}</p>
          )}
          <MetaList>
            <MetaRow label={t('ext.permissions')}>
              {ext.permissions.length
                ? ext.permissions.map((p) => t(PERMISSION_KEY[p])).join(', ')
                : t('ext.none')}
            </MetaRow>
            <MetaRow label={t('ext.network')} mono={ext.network.length > 0}>
              {ext.network.length ? ext.network.join(', ') : t('ext.none')}
            </MetaRow>
            {ext.commands.length > 0 && (
              <MetaRow label={t('ext.commands')}>{ext.commands.map((c) => c.title).join(', ')}</MetaRow>
            )}
            <MetaRow label={t('ext.folder')} mono>
              {ext.dir}
            </MetaRow>
            {ext.problems.length > 0 && <MetaRow label={t('ext.dropped')}>{ext.problems.join('; ')}</MetaRow>}
          </MetaList>
          <p className="c-ext__text c-ext__text--muted">{t('ext.never')}</p>
          <div className="c-ext__actions">
            <Button variant="primary" onClick={() => void api.extensionsSetEnabled(ext.id, true)}>
              {t('ext.enable')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
