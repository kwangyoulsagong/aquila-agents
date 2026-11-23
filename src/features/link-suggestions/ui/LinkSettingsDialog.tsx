import { useState } from 'react';
import {
  Button,
  Checklist,
  ChecklistItem,
  Dialog,
  DialogForm,
  Dot,
  FieldRow,
  EmptyState,
  Input,
  Label,
  MetaList,
  MetaRow,
  Segment,
  type DotStatus,
} from '@design-system/react';
import { api, type GraphAiState, type GraphRule, type GraphRulePattern } from '@/shared/api';
import { useT, type Translate } from '@/shared/i18n';
import { sourceName } from '@/entities/note';
import { patternLabel } from '../model/suggestions';
import { useLinkSettings } from '../model/useLinkSettings';
import { useLinkDecisions } from '../model/useLinkDecisions';

function aiLine(t: Translate, s: GraphAiState | undefined): { dot: DotStatus; text: string } {
  if (!s) return { dot: 'stopped', text: t('links.ai.offState') };
  const counts = t('links.ai.state', { today: String(s.today), cap: String(s.cap), queued: String(s.queued) });
  if (s.error) return { dot: 'error', text: t('links.ai.error', { error: s.error }) };
  if (s.running) return { dot: 'working', text: `${t('links.ai.running')} · ${counts}` };
  if (s.waitingForPower) return { dot: 'waiting', text: `${t('links.ai.power')} · ${counts}` };
  return { dot: 'done', text: counts };
}

/** `DB` / `DB-<n>` → an ID rule; anything with a dot → a URL host. */
const patternOf = (text: string): GraphRulePattern =>
  /\./.test(text) ? { kind: 'url', host: text.trim() } : { kind: 'id', prefix: text.trim() };

function RuleRow({ rule }: { rule: GraphRule }) {
  const t = useT();
  const [draft, setDraft] = useState<string | null>(null);
  const update = (r: GraphRule) => void api.graphRule({ op: 'update', rule: r });
  const label = patternLabel(rule.pattern);
  return (
    <ChecklistItem
      leading={<Dot status={rule.enabled ? 'done' : 'stopped'} label={rule.enabled ? t('links.rule.on') : t('links.rule.off')} />}
      title={
        draft === null ? (
          t(rule.pattern.kind === 'id' ? 'links.rule.id' : 'links.rule.url', { pattern: label })
        ) : (
          <Input
            autoFocus
            value={draft}
            aria-label={t('links.rule.edit')}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                update({ ...rule, pattern: patternOf(draft) });
                setDraft(null);
              }
              if (e.key === 'Escape') {
                e.stopPropagation();
                setDraft(null);
              }
            }}
            onBlur={() => setDraft(null)}
          />
        )
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => setDraft(label)}>
            {t('links.rule.edit')}
          </Button>
          <Button variant="ghost" onClick={() => update({ ...rule, enabled: !rule.enabled })}>
            {t(rule.enabled ? 'sources.turnOff' : 'sources.turnOn')}
          </Button>
          <Button variant="ghost" onClick={() => void api.graphRule({ op: 'remove', id: rule.id })}>
            {t('links.rule.remove')}
          </Button>
        </>
      }
    />
  );
}

/**
 * Settings ▸ Link suggestions… (T68): AI extraction per source (opt-in, with the quota note and today's count),
 * rule proposals, and the rules themselves — edit, turn off, remove, add.
 */
export default function LinkSettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { status, setAi, runNow } = useLinkSettings();
  const d = useLinkDecisions();
  const [newRule, setNewRule] = useState('');
  const [kind, setKind] = useState<'id' | 'url'>('id');
  const links = status?.links;
  const sources = status?.sources ?? [];
  const cap = links?.ai[0]?.cap ?? 40;
  const add = () => {
    if (!newRule.trim()) return;
    void d.makeRule(kind === 'id' ? { kind: 'id', prefix: newRule } : { kind: 'url', host: newRule });
    setNewRule('');
  };
  return (
    <Dialog
      open
      wide
      title={t('links.title')}
      onClose={onClose}
      actions={
        <Button variant="primary" onClick={onClose}>
          {t('action.close')}
        </Button>
      }
    >
      <p>{t('links.body')}</p>
      {links && (links.accepted > 0 || links.rejected > 0) && (
        <MetaList>
          <MetaRow label={t('links.decisions')}>
            {t('links.summary', { accepted: String(links.accepted), rejected: String(links.rejected) })}
          </MetaRow>
        </MetaList>
      )}

      <Label>{t('links.ai')}</Label>
      <p>{t('links.aiBody')}</p>
      <p>{t('links.quota', { cap: String(cap) })}</p>
      {status && !sources.length ? (
        <EmptyState>{t('links.sourcesEmpty')}</EmptyState>
      ) : (
        <Checklist label={t('links.ai')}>
          {sources.map((s) => {
            const st = links?.ai.find((a) => a.sourceId === s.id);
            const line = s.ai && s.enabled ? aiLine(t, st) : { dot: 'stopped' as const, text: t('links.ai.offState') };
            return (
              <ChecklistItem
                key={s.id}
                leading={<Dot status={line.dot} label={line.text} />}
                title={sourceName(s.path)}
                meta={line.text}
                actions={
                  <>
                    {s.ai && s.enabled && (
                      <Button disabled={!st?.queued || st.running} onClick={() => void runNow(s.id)}>
                        {t('links.runNow')}
                      </Button>
                    )}
                    <Button variant="ghost" disabled={!s.enabled} onClick={() => void setAi(s.id, !s.ai)}>
                      {t(s.ai ? 'links.aiOff' : 'links.aiOn')}
                    </Button>
                  </>
                }
              />
            );
          })}
        </Checklist>
      )}

      <Label>{t('links.rules')}</Label>
      {links?.proposals.map((p) => (
        <MetaList key={p.key}>
          <MetaRow label={t('links.proposalShort')}>
            {t('links.proposal', { pattern: patternLabel(p.pattern), n: String(p.accepts) })}{' '}
            <Button onClick={() => void d.makeRule(p.pattern)}>{t('links.makeRule')}</Button>{' '}
            <Button variant="ghost" onClick={() => void d.dismiss(p.key)}>
              {t('links.notNow')}
            </Button>
          </MetaRow>
        </MetaList>
      ))}
      {links?.rules.length ? (
        <Checklist label={t('links.rules')}>
          {links.rules.map((r) => (
            <RuleRow key={r.id} rule={r} />
          ))}
        </Checklist>
      ) : (
        <EmptyState>{t('links.rulesEmpty')}</EmptyState>
      )}
      <DialogForm id="link-rule-add" onSubmit={add}>
        <FieldRow>
          <Input
            value={newRule}
            placeholder={kind === 'id' ? 'DB-<n>' : 'github.com'}
            aria-label={t('links.addRule')}
            onChange={(e) => setNewRule(e.currentTarget.value)}
          />
          <Segment
            label={t('links.addRule')}
            value={kind}
            onChange={setKind}
            options={[
              { value: 'id', label: t('links.kind.id') },
              { value: 'url', label: t('links.kind.url') },
            ]}
          />
          <Button type="submit" disabled={!newRule.trim()}>
            {t('links.addRule')}
          </Button>
        </FieldRow>
      </DialogForm>
    </Dialog>
  );
}
