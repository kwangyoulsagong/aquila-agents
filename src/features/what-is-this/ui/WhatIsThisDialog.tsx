import { useEffect, useRef, useState } from 'react';
import {
  Brief,
  BriefCard,
  BriefField,
  BriefMeta,
  BriefNotice,
  BriefPreview,
  BriefRelated,
  BriefRelatedItem,
  Button,
  Dialog,
  Dropzone,
  Elapsed,
  Field,
  FieldGrid,
  Input,
  Segment,
  Select,
  Textarea,
} from '@design-system/react';
import { api, type BriefModel } from '@/shared/api';
import { useT } from '@/shared/i18n';
import {
  defaultTitle,
  formatCount,
  isEmpty,
  readDrop,
  readFile,
  whyLabel,
  type BriefSeed,
} from '../model/brief';
import { useWhatIsThis } from '../model/useWhatIsThis';

interface Props {
  /** The selected project: its Claude account runs it; its note folder is the default save place. */
  projectId: string | null;
  /** A file or text dropped on the button before the dialog opened. */
  seed?: BriefSeed;
  onClose: () => void;
  onOpenNote: (path: string) => void;
}

/** "What is this?" (T81): drop / paste → see exactly what is sent → Ask Claude → a short card → Save as note. */
export default function WhatIsThisDialog({ projectId, seed, onClose, onOpenNote }: Props) {
  const t = useT();
  const b = useWhatIsThis(projectId, seed);
  const [over, setOver] = useState(false);
  const [linked, setLinked] = useState<Set<string>>(new Set());
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const { prepared, result, phase, targets } = b;
  const running = phase === 'running';

  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [running]);

  // A new result: a title to start from, the default place, nothing saved yet.
  useEffect(() => {
    if (!result || !prepared) return;
    setTitle(defaultTitle(result.fields, prepared.label, new Date()));
    setSaved(null);
    setSaveError(false);
  }, [result, prepared]);
  useEffect(() => {
    if (targets && !sourceId) setSourceId(targets.defaultId);
  }, [targets, sourceId]);

  const drop = async (dt: DataTransfer) => b.setSeed(await readDrop(dt, t));

  const save = async () => {
    if (!result || !prepared || !sourceId || !title.trim()) return;
    setSaveError(false);
    const links = b.related
      .filter((r) => linked.has(r.path))
      .map((r) => ({ path: r.path, why: whyLabel(r, t) }));
    const p = await api
      .briefSave({
        sourceId,
        title,
        source: prepared.label || t(`brief.kind.${prepared.kind}`),
        kind: prepared.kind,
        fields: result.fields,
        ...(result.raw ? { raw: result.raw } : {}),
        links,
      })
      .catch(() => null);
    if (p) setSaved(p);
    else setSaveError(true);
  };

  const fromFile = !!b.input?.name;
  const target = targets?.sources.find((s) => s.id === sourceId);
  const f = result?.fields ?? null;

  return (
    <Dialog
      open
      wide
      title={t('brief.title')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('brief.close')}</Button>
          {running ? (
            <Button onClick={b.cancel}>{t('brief.cancel')}</Button>
          ) : (
            <Button
              variant="primary"
              disabled={!prepared || !prepared.text.trim()}
              onClick={() => void b.run()}
            >
              {t('brief.run')}
            </Button>
          )}
        </>
      }
    >
      <Brief>
        {/* Input: a dropped / picked file, or pasted text (an email with its headers, a Figma link). */}
        <Dropzone
          over={over}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void drop(e.dataTransfer);
          }}
        >
          {t('brief.drop')}
          <Button onClick={() => fileRef.current?.click()}>{t('brief.pick')}</Button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".md,.markdown,.txt,.eml,.html,.htm,text/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void readFile(file, t).then(b.setSeed);
            }}
          />
        </Dropzone>
        {b.seedError && <BriefNotice warn>{b.seedError}</BriefNotice>}
        {fromFile ? (
          <BriefMeta label={b.input?.name}>
            <Button variant="ghost" onClick={b.clear}>
              {t('brief.clearFile')}
            </Button>
          </BriefMeta>
        ) : (
          <Textarea
            aria-label={t('brief.paste')}
            placeholder={t('brief.paste')}
            rows={4}
            value={b.input?.text ?? ''}
            onChange={(e) => b.setText(e.target.value)}
          />
        )}

        {/* Exactly what goes to Claude, before anything runs. */}
        {prepared && prepared.text.trim() && (
          <>
            <BriefMeta label={prepared.label || undefined}>
              <span>{t(`brief.kind.${prepared.kind}`)}</span>
              <span>{t('brief.chars', { n: formatCount(prepared.chars) })}</span>
            </BriefMeta>
            {prepared.cut && (
              <BriefNotice>
                {t('brief.cut', {
                  n: formatCount(prepared.chars),
                  total: formatCount(prepared.originalChars),
                })}
              </BriefNotice>
            )}
            {prepared.headersStripped && <BriefNotice>{t('brief.headers')}</BriefNotice>}
            {prepared.figma && (
              <BriefNotice>{t(prepared.figma.connected ? 'brief.figmaOn' : 'brief.figmaOff')}</BriefNotice>
            )}
            <BriefPreview summary={t('brief.preview')} text={prepared.text} />
            <BriefNotice warn>
              {prepared.account ? t('brief.warn', { account: prepared.account }) : t('brief.warnShared')}
            </BriefNotice>
            <Segment<BriefModel>
              label={t('brief.model')}
              value={b.model}
              onChange={b.setModel}
              options={[
                { value: 'haiku', label: t('brief.haiku') },
                { value: 'sonnet', label: t('brief.sonnet') },
              ]}
            />
          </>
        )}

        {running && (
          <BriefMeta label={t('brief.running')}>
            <Elapsed>{`${seconds}s`}</Elapsed>
          </BriefMeta>
        )}
        {phase === 'error' && b.error && (
          <BriefNotice warn>
            {b.error === 'timeout' ? t('brief.timeout') : t('brief.failed', { error: b.error })}
          </BriefNotice>
        )}

        {/* The card: fixed fields, short. */}
        {result && (
          <BriefCard label={t('brief.card')}>
            {result.cached && <BriefNotice>{t('brief.cached')}</BriefNotice>}
            {f && isEmpty(f) && <BriefNotice>{t('brief.empty')}</BriefNotice>}
            {f && (
              <>
                {f.product && <BriefField label={t('brief.product')} text={f.product} />}
                {f.feature && <BriefField label={t('brief.feature')} text={f.feature} />}
                {f.intent && <BriefField label={t('brief.intent')} text={f.intent} />}
                {f.points.length > 0 && <BriefField label={t('brief.points')} items={f.points} />}
                {f.questions.length > 0 && <BriefField label={t('brief.questions')} items={f.questions} />}
                {f.terms.length > 0 && <BriefField label={t('brief.terms')} terms={f.terms} />}
              </>
            )}
            {!f && result.raw && (
              <BriefField label={t('brief.raw')}>
                <BriefNotice>{t('brief.rawNote')}</BriefNotice>
                <BriefPreview summary={t('brief.raw')} text={result.raw} />
              </BriefField>
            )}
          </BriefCard>
        )}

        {/* Related notes from the local index — no model. */}
        {prepared && prepared.text.trim() && (
          <BriefField label={t('brief.related')}>
            {targets && targets.sources.length === 0 ? (
              <BriefNotice>{t('brief.relatedOff')}</BriefNotice>
            ) : b.related.length === 0 ? (
              <BriefNotice>{t('brief.relatedNone')}</BriefNotice>
            ) : (
              <>
                <BriefNotice>{t('brief.relatedHint')}</BriefNotice>
                <BriefRelated label={t('brief.related')}>
                  {b.related.map((r) => (
                    <BriefRelatedItem
                      key={r.path}
                      title={r.title}
                      why={whyLabel(r, t)}
                      onOpen={() => onOpenNote(r.path)}
                      {...(result
                        ? {
                            linked: linked.has(r.path),
                            linkLabel: t('brief.link'),
                            onToggle: () =>
                              setLinked((s) => {
                                const next = new Set(s);
                                if (next.has(r.path)) next.delete(r.path);
                                else next.add(r.path);
                                return next;
                              }),
                          }
                        : {})}
                    />
                  ))}
                </BriefRelated>
              </>
            )}
          </BriefField>
        )}

        {/* Save: only on the button, into the folder picked here. */}
        {result && targets && (
          <BriefField label={t('brief.save')}>
            {targets.sources.length === 0 ? (
              <BriefNotice>{t('brief.noTargets')}</BriefNotice>
            ) : saved ? (
              <BriefMeta label={t('brief.saved', { path: saved })}>
                <Button variant="ghost" onClick={() => onOpenNote(saved)}>
                  {t('brief.open')}
                </Button>
              </BriefMeta>
            ) : (
              <>
                <FieldGrid>
                  <Field
                    label={t('brief.saveTo')}
                    hint={target ? `${target.path}${target.folder ? `/${target.folder}` : ''}` : undefined}
                  >
                    <Select
                      value={sourceId ?? ''}
                      onChange={setSourceId}
                      options={targets.sources.map((s) => ({
                        value: s.id,
                        label: s.path.split('/').pop() || s.path,
                      }))}
                    />
                  </Field>
                  <Field label={t('brief.saveTitle')}>
                    <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
                  </Field>
                </FieldGrid>
                <BriefMeta>
                  <Button disabled={!sourceId || !title.trim()} onClick={() => void save()}>
                    {t('brief.save')}
                  </Button>
                  {saveError && <BriefNotice warn>{t('brief.saveFailed')}</BriefNotice>}
                </BriefMeta>
              </>
            )}
          </BriefField>
        )}
      </Brief>
    </Dialog>
  );
}
