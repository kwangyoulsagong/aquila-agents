import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Field,
  Modal,
  ModalActions,
  ModalBullets,
  ModalDetail,
  ModalNote,
  ModalTools,
  Segment,
  Select,
  Textarea,
} from '@design-system/react';
import type { ApplyStartResult, Language } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { RepoGraph, type GraphMode } from '@/entities/repo-graph';
import { ApplySteps, stepNodes, useApplyTrend } from '@/features/apply-trend';

export interface ApplyItem {
  itemId: string;
  title: string;
}

interface Props {
  item: ApplyItem | null;
  /** Local projects (remote ones can't be applied to). */
  projects: { id: string; label: string }[];
  /** The focused project when it is local. */
  defaultProjectId?: string;
  language: Language;
  onClose: () => void;
  /** Apply opened a worktree tab: the page adds it and pastes the steps. */
  onStarted: (projectId: string, result: ApplyStartResult) => void;
}

/**
 * Apply a trend (T64): the repo skeleton as a graph with a Now / After toggle, Claude's verdict, benefits, steps to
 * tick (hover highlights their nodes) and what doesn't fit; Cancel / Edit / Apply. Edit rewrites or unticks steps and
 * adds a request → Analyse again, or Apply as is.
 */
export default function TrendApplyModal({
  item,
  projects,
  defaultProjectId,
  language,
  onClose,
  onStarted,
}: Props) {
  const t = useT();
  const [projectId, setProjectId] = useState(defaultProjectId ?? projects[0]?.id ?? '');
  const [mode, setMode] = useState<GraphMode>('after');
  const [hovered, setHovered] = useState<string | null>(null);
  // Each opening starts from the focused project.
  useEffect(() => {
    if (item) setProjectId(defaultProjectId ?? projects[0]?.id ?? '');
    setMode('after');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when another trend is opened
  }, [item?.itemId]);
  const a = useApplyTrend(item && projectId ? { itemId: item.itemId, projectId, language } : null);
  const p = a.record?.proposal ?? null;
  const editing = a.phase === 'editing';
  const ticked = a.drafts.filter((d) => d.on).length;
  const busy = a.phase === 'scanning' || a.phase === 'analysing' || a.phase === 'starting';

  const apply = () =>
    void a.start().then((r) => {
      if (r) onStarted(projectId, r);
    });
  const cancel = () => {
    a.drop();
    onClose();
  };

  const status =
    a.phase === 'scanning'
      ? t('apply.scanning')
      : a.phase === 'analysing'
        ? t('apply.analysing')
        : a.phase === 'starting'
          ? t('apply.starting')
          : null;

  return (
    <Modal
      open={!!item}
      onClose={onClose}
      wide
      title={t('apply.title')}
      subtitle={item?.title}
      closeLabel={t('action.close')}
      footer={<span>{t('apply.footer')}</span>}
    >
      {!projects.length ? (
        <ModalNote warn>{t('apply.noLocal')}</ModalNote>
      ) : (
        <>
          <ModalTools>
            <Field label={t('apply.project')}>
              <Select
                value={projectId}
                disabled={busy}
                options={projects.map((x) => ({ value: x.id, label: x.label }))}
                onChange={setProjectId}
              />
            </Field>
            {p && (
              <Segment
                label={t('apply.view')}
                options={[
                  { value: 'now', label: t('apply.now') },
                  { value: 'after', label: t('apply.after') },
                ]}
                value={mode}
                onChange={setMode}
              />
            )}
          </ModalTools>
          {a.skeleton && (
            <RepoGraph
              skeleton={a.skeleton}
              proposal={p}
              mode={p ? mode : 'now'}
              highlight={stepNodes(a.drafts, hovered)}
            />
          )}
          {status && (
            <ModalActions>
              <span role="status">{status}</span>
              {a.phase === 'analysing' && <Button onClick={a.cancel}>{t('apply.stop')}</Button>}
            </ModalActions>
          )}
          {a.error && <ModalNote warn>{t('apply.failed', { error: a.error })}</ModalNote>}
          {a.phase === 'ready' && (
            <>
              <ModalActions>
                <Button variant="primary" onClick={a.analyse}>
                  {t('apply.analyse')}
                </Button>
              </ModalActions>
              <ModalNote>{t('apply.quota')}</ModalNote>
            </>
          )}
          {p && (
            <>
              <ModalDetail
                heading={
                  <>
                    <Badge tone={`verdict-${p.verdict}`}>{t(`apply.verdict.${p.verdict}`)}</Badge> {p.summary}
                  </>
                }
              />
              {p.benefits.length > 0 && <ModalBullets items={p.benefits} />}
              {a.drafts.length > 0 && (
                <ApplySteps drafts={a.drafts} editing={editing} onChange={a.setDraft} onHover={setHovered} />
              )}
              {p.unfit.length > 0 && (
                <>
                  <ModalNote>{t('apply.unfit')}</ModalNote>
                  <ModalBullets
                    items={p.unfit.map((u) => (
                      <>
                        <strong>{u.title}</strong> — {u.why}
                      </>
                    ))}
                  />
                </>
              )}
              {editing && (
                <Field label={t('apply.request')}>
                  <Textarea
                    value={a.request}
                    placeholder={t('apply.requestHint')}
                    onChange={(e) => a.setRequest(e.target.value)}
                  />
                </Field>
              )}
              {editing ? (
                <ModalActions>
                  <Button onClick={a.back}>{t('apply.back')}</Button>
                  <Button onClick={a.analyse}>{t('apply.again')}</Button>
                  <Button variant="primary" disabled={!ticked} onClick={apply}>
                    {t('apply.asIs')}
                  </Button>
                </ModalActions>
              ) : (
                a.phase === 'proposal' && (
                  <ModalActions>
                    <Button onClick={cancel}>{t('apply.cancel')}</Button>
                    <Button onClick={a.edit}>{t('apply.edit')}</Button>
                    <Button variant="primary" disabled={!ticked} onClick={apply}>
                      {t('apply.apply', { n: String(ticked) })}
                    </Button>
                  </ModalActions>
                )
              )}
              <ModalNote>{t('apply.applyNote')}</ModalNote>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
