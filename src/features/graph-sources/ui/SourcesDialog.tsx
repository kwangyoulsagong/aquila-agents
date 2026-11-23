import { Button, Checklist, Dialog, EmptyState, MetaList, MetaRow } from '@design-system/react';
import { SourceItem } from '@/entities/note';
import { useT } from '@/shared/i18n';
import { useSources } from '../model/useSources';

/**
 * Settings → Note sources (T65): folders of Markdown (in repos or not) that make up the knowledge graph. Add, turn
 * on/off, remove (files are never touched), "Index now" for a first index paused in power saver.
 */
export default function SourcesDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { status, problem, add, remove, setEnabled, indexNow } = useSources();
  const sources = status?.sources ?? [];
  return (
    <Dialog
      open
      wide
      title={t('sources.title')}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={() => void add()}>
            {t('sources.add')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('action.close')}
          </Button>
        </>
      }
    >
      <p>{t('sources.body')}</p>
      {problem && problem !== 'other' && <p role="alert">{t(`sources.error.${problem}`)}</p>}
      {status && !sources.length ? (
        <EmptyState>{t('sources.empty')}</EmptyState>
      ) : (
        <Checklist label={t('sources.title')}>
          {sources.map((s) => (
            <SourceItem
              key={s.id}
              source={s}
              actions={
                <>
                  {s.state === 'paused' && (
                    <Button onClick={() => void indexNow(s.id)}>
                      {t('sources.indexNow')}
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => void setEnabled(s.id, !s.enabled)}>
                    {t(s.enabled ? 'sources.turnOff' : 'sources.turnOn')}
                  </Button>
                  <Button
                   
                    variant="ghost"
                    title={t('sources.removeHint')}
                    onClick={() => void remove(s.id)}
                  >
                    {t('sources.remove')}
                  </Button>
                </>
              }
            />
          ))}
        </Checklist>
      )}
      {status && status.notes > 0 && (
        <MetaList>
          <MetaRow label={t('sources.index')}>
            {t('sources.summary', { notes: String(status.notes), edges: String(status.edges) })}
          </MetaRow>
          {status.idGroups.length > 0 && (
            <MetaRow label={t('sources.idGroups')}>
              {status.idGroups
                .slice(0, 6)
                .map((g) => t('sources.idGroup', { prefix: g.prefix, notes: String(g.notes) }))
                .join(' · ')}
            </MetaRow>
          )}
        </MetaList>
      )}
    </Dialog>
  );
}
