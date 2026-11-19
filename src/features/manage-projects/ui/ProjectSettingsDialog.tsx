import { useEffect, useId, useState } from 'react';
import {
  Button,
  Dialog,
  DialogForm,
  Field,
  FieldGrid,
  FieldRow,
  Input,
  Segment,
  Select,
  Textarea,
} from '@design-system/react';
import { api, PORT_BASE_MAX, PORT_BASE_MIN, type Config, type Project, type SessionKind } from '@/shared/api';
import { accountLabel, groupLabel, kindLabel, useT } from '@/shared/i18n';
import { editorOptions, parsePort, toForm, toSettings, type SettingsForm } from '../model/settings';
import { useDuplicateFolder } from '../model/useDuplicateFolder';

interface Props {
  project: Project;
  config: Config;
  onClose: () => void;
  onSave: (settings: ReturnType<typeof toSettings>) => Promise<void>;
}

const KINDS: SessionKind[] = ['claude', 'codex', 'shell'];

/** Per-project defaults: folder, group, account, default agent, worktree base branch + setup, ports, editor. */
export default function ProjectSettingsDialog({ project, config, onClose, onSave }: Props) {
  const t = useT();
  const formId = useId();
  const branchList = useId();
  const [form, setForm] = useState<SettingsForm>(() => toForm(project));
  const [branches, setBranches] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const duplicate = useDuplicateFolder(config, form.path, project.id);
  const portInvalid = parsePort(form.portBase) === null;

  // Branch suggestions for "Default branch" (empty outside a repo).
  useEffect(() => {
    let live = true;
    api
      .worktreeInfo(project.id)
      .then((info) => live && setBranches(info.branches))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [project.id]);

  const pickFolder = async () => {
    try {
      const path = await api.pickFolder();
      if (path) set('path', path);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submit = async () => {
    if (busy || portInvalid || !form.name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(toSettings(form, project));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      wide
      title={t('settings.title', { name: project.name })}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form={formId}
            disabled={busy || portInvalid || !form.name.trim()}
          >
            {t('action.save')}
          </Button>
        </>
      }
    >
      <DialogForm id={formId} onSubmit={submit}>
        <Field label={t('projects.name')}>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field
          label={t('projects.folder')}
          warning={duplicate && t('settings.duplicate', { name: duplicate })}
          hint={form.path !== project.path ? t('settings.folderMoved') : undefined}
        >
          <FieldRow>
            <Input value={form.path} readOnly />
            <Button onClick={pickFolder}>{t('settings.change')}</Button>
          </FieldRow>
        </Field>
        <FieldGrid>
          <Field label={t('projects.group')}>
            <Select
              value={form.group}
              onChange={(v) => set('group', v)}
              options={config.groups.map((g) => ({ value: g.id, label: groupLabel(t, g) }))}
            />
          </Field>
          <Field label={t('account.title')}>
            <Select
              value={form.account}
              onChange={(v) => set('account', v)}
              options={Object.entries(config.accounts).map(([id, a]) => ({
                value: id,
                label: accountLabel(t, id, a),
              }))}
            />
          </Field>
        </FieldGrid>
        <Field label={t('settings.defaultAgent')} hint={t('settings.defaultAgentHint')}>
          <Segment
            label={t('settings.defaultAgent')}
            value={form.defaultAgent}
            onChange={(v) => set('defaultAgent', v)}
            options={KINDS.map((k) => ({ value: k, label: kindLabel(t, k) }))}
          />
        </Field>
        <FieldGrid>
          <Field label={t('settings.defaultBranch')} hint={t('settings.defaultBranchHint')}>
            <Input
              value={form.defaultBranch}
              onChange={(e) => set('defaultBranch', e.target.value)}
              list={branchList}
              placeholder="main"
            />
          </Field>
          <Field
            label={t('settings.portBase')}
            hint={t('settings.portBaseHint')}
            warning={
              portInvalid &&
              t('settings.portInvalid', { min: String(PORT_BASE_MIN), max: String(PORT_BASE_MAX) })
            }
          >
            <Input
              value={form.portBase}
              onChange={(e) => set('portBase', e.target.value)}
              inputMode="numeric"
              placeholder="3000"
            />
          </Field>
        </FieldGrid>
        <datalist id={branchList}>
          {branches.map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
        <Field label={t('settings.setupScript')} hint={t('settings.setupScriptHint')}>
          <Textarea
            value={form.setupScript}
            onChange={(e) => set('setupScript', e.target.value)}
            placeholder={'npm ci\ncp ../.env .env'}
            spellCheck={false}
          />
        </Field>
        <Field label={t('settings.openIn')}>
          <Select
            value={form.openIn}
            onChange={(v) => set('openIn', v)}
            options={[
              { value: '', label: 'Finder' },
              ...editorOptions(project.openIn).map((app) => ({ value: app, label: app })),
            ]}
          />
        </Field>
      </DialogForm>
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
