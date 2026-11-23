import { Badge, Input, StepItem, StepList } from '@design-system/react';
import { useT } from '@/shared/i18n';
import type { StepDraft } from '../model/drafts';

interface Props {
  drafts: StepDraft[];
  /** Edit: titles become inputs. */
  editing: boolean;
  onChange: (id: string, patch: Partial<Omit<StepDraft, 'step'>>) => void;
  /** Hovered step (null when the pointer leaves): the graph highlights its nodes. */
  onHover: (id: string | null) => void;
}

/** The proposal's steps as checkboxes, size and risk tags, the files they touch; titles editable in Edit. */
export default function ApplySteps({ drafts, editing, onChange, onHover }: Props) {
  const t = useT();
  return (
    <StepList label={t('apply.steps')}>
      {drafts.map((d, i) => (
        <StepItem
          key={d.step.id}
          checked={d.on}
          onToggle={(on) => onChange(d.step.id, { on })}
          checkLabel={t('apply.stepCheck', { n: String(i + 1) })}
          title={
            editing ? (
              <Input
                value={d.title}
                aria-label={t('apply.stepTitle', { n: String(i + 1) })}
                onChange={(e) => onChange(d.step.id, { title: e.target.value })}
              />
            ) : (
              <span>{d.title}</span>
            )
          }
          tags={
            <>
              <Badge>{d.step.size}</Badge>
              <Badge tone={d.step.risk === 'high' ? 'risk' : undefined}>
                {t(`apply.risk.${d.step.risk}`)}
              </Badge>
            </>
          }
          meta={d.step.files.length ? d.step.files.join(' · ') : undefined}
          onHover={(on) => onHover(on ? d.step.id : null)}
        />
      ))}
    </StepList>
  );
}
