import { useState } from 'react';
import {
  Button,
  EmptyState,
  Field,
  Modal,
  ModalActions,
  ModalBullets,
  ModalDetail,
  ModalItem,
  ModalList,
  ModalNote,
  Segment,
  Textarea,
} from '@design-system/react';
import type { VaultPresetId, VaultScope } from '@/shared/api';
import { sourceName } from '@/entities/note';
import { useT } from '@/shared/i18n';
import { summarize } from '../model/config';
import { useVaultSettings } from '../model/useVaultSettings';

const PRESETS: VaultPresetId[] = ['basic', 'status-board', 'daily', 'meeting', 'empty'];

/**
 * Settings ▸ Folder settings (T69): how each source is shaped — link rules, property types, templates, companion
 * files, views and note actions. Start from a preset or "Make with Claude", look at the preview and the text, then
 * save as mine (`~/.aquila/vaults`) or shared (`.aquila-vault.json` in the folder).
 */
export default function VaultSettingsDialog({
  initialSource,
  onClose,
  onOpenView,
}: {
  initialSource?: string;
  onClose: () => void;
  onOpenView: (sourceId: string, viewId: string) => void;
}) {
  const t = useT();
  const v = useVaultSettings(initialSource);
  const [ask, setAsk] = useState('');
  const source = v.sources?.find((s) => s.id === v.selected);
  const summary = 'config' in v.parsed ? summarize(v.parsed.config) : [];
  const where =
    v.state?.scope === 'personal'
      ? t('vault.scope.personalNow')
      : v.state?.scope === 'shared'
        ? t('vault.scope.sharedNow')
        : t('vault.scope.none');

  return (
    <Modal
      open
      wide
      title={t('vault.title')}
      subtitle={t('vault.subtitle')}
      onClose={onClose}
      closeLabel={t('action.close')}
      aside={
        <ModalList id="vault-sources" label={t('vault.sources')}>
          {(v.sources ?? []).map((s) => (
            <ModalItem
              key={s.id}
              id={`vault-source-${s.id}`}
              selected={s.id === v.selected}
              label={sourceName(s.path)}
              meta={s.enabled ? undefined : t('sources.state.off')}
              onSelect={() => v.select(s.id)}
            />
          ))}
        </ModalList>
      }
    >
      {v.sources && !v.sources.length ? (
        <EmptyState>{t('vault.noSources')}</EmptyState>
      ) : !source || !v.state ? null : (
        <>
          <ModalDetail heading={sourceName(source.path)} text={where} />
          {v.state.hasShared && v.state.scope === 'personal' && (
            <ModalNote>{t('vault.sharedHidden')}</ModalNote>
          )}
          {v.state.problems.length > 0 && (
            <ModalNote warn>{t('vault.problems', { list: v.state.problems.join(', ') })}</ModalNote>
          )}

          <ModalNote>{t('vault.presetsHint')}</ModalNote>
          <ModalActions>
            {PRESETS.map((p) => (
              <Button key={p} variant="ghost" onClick={() => void v.applyPreset(p)}>
                {t(`vault.preset.${p}`)}
              </Button>
            ))}
          </ModalActions>

          <Field label={t('vault.claude')}>
            <Textarea
              value={ask}
              placeholder={t('vault.claudePlaceholder')}
              onChange={(e) => setAsk(e.target.value)}
            />
          </Field>
          <ModalNote>{t('vault.claudeQuota')}</ModalNote>
          <ModalActions>
            <Button disabled={v.suggest.kind === 'running'} onClick={() => void v.makeWithClaude(ask)}>
              {v.suggest.kind === 'running' ? t('vault.claudeRunning') : t('vault.claudeMake')}
            </Button>
            {v.suggest.kind === 'error' && (
              <ModalNote warn>{t('vault.claudeFailed', { error: v.suggest.error })}</ModalNote>
            )}
          </ModalActions>

          {summary.length > 0 ? (
            <ModalBullets
              items={summary.map((s) => `${t(`vault.section.${s.section}`)}: ${s.names.join(', ')}`)}
            />
          ) : (
            <ModalNote>{t('vault.emptyConfig')}</ModalNote>
          )}

          <Field
            label={t('vault.text')}
            hint={t('vault.textHint')}
            warning={'error' in v.parsed ? t('vault.badJson', { error: v.parsed.error }) : undefined}
          >
            <Textarea
              code
              value={v.draft}
              onChange={(e) => v.edit(e.target.value)}
              aria-label={t('vault.text')}
            />
          </Field>

          {v.saved && (
            <ModalNote warn={v.saved.problems.length > 0}>
              {v.saved.problems.length
                ? t('vault.savedDropped', { list: v.saved.problems.join(', ') })
                : t('vault.saved')}
            </ModalNote>
          )}

          <ModalActions>
            <Segment<VaultScope>
              label={t('vault.scope.label')}
              value={v.scope}
              onChange={v.setScope}
              options={[
                { value: 'personal', label: t('vault.scope.personal') },
                { value: 'shared', label: t('vault.scope.shared') },
              ]}
            />
            <Button
              variant="primary"
              disabled={'error' in v.parsed || (!v.dirty && v.scope === v.state.scope)}
              onClick={() => void v.save()}
            >
              {t('vault.save')}
            </Button>
            {v.state.scope === 'personal' && v.state.hasShared && (
              <Button variant="ghost" onClick={() => void v.removePersonal()}>
                {t('vault.useShared')}
              </Button>
            )}
          </ModalActions>
          <ModalNote>
            {t(v.scope === 'shared' ? 'vault.scope.sharedHint' : 'vault.scope.personalHint')}
          </ModalNote>

          {v.state.config.views.length > 0 && (
            <>
              <ModalNote>{t('vault.openView')}</ModalNote>
              <ModalActions>
                {v.state.config.views.map((view) => (
                  <Button key={view.id} variant="ghost" onClick={() => onOpenView(source.id, view.id)}>
                    {view.name}
                  </Button>
                ))}
              </ModalActions>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
