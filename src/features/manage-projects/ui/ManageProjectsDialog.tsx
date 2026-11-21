import { useId, useState } from 'react';
import { Button, Dialog, DialogForm, Field, Input, Select } from '@design-system/react';
import { fitsGroup, type Config, type ProjectSettings, type RemoteHost } from '@/shared/api';
import { accountLabel, groupLabel, useT } from '@/shared/i18n';
import type { ManageDialog } from '../model/useManageProjects';
import { useDuplicateFolder } from '../model/useDuplicateFolder';
import ProjectSettingsDialog, { type RenderFigma } from './ProjectSettingsDialog';
import RemoteProjectDialog from './RemoteProjectDialog';

interface Props {
  dialog: ManageDialog;
  config: Config;
  /** Preselected in the add dialog (the current project's group and account). */
  defaults: { group?: string; account?: string };
  onClose: () => void;
  /** Figma MCP block in project settings (T32). */
  renderFigma?: RenderFigma;
  onAdd: (values: {
    name: string;
    group: string;
    account?: string;
    path?: string;
    remote?: RemoteHost;
  }) => Promise<void>;
  onName: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
  onSettings: (settings: ProjectSettings) => Promise<void>;
}

const folderName = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;

/** The one open project/group dialog: add, settings, rename, new group, remove. */
export default function ManageProjectsDialog(props: Props) {
  const { dialog } = props;
  if (dialog.kind === 'settings')
    return (
      <ProjectSettingsDialog
        project={dialog.project}
        config={props.config}
        onClose={props.onClose}
        onSave={props.onSettings}
        renderFigma={props.renderFigma}
        focus={dialog.focus}
      />
    );
  if (dialog.kind === 'addRemote') return <RemoteProjectDialog onClose={props.onClose} onAdd={props.onAdd} />;
  return <SimpleDialog {...props} />;
}

function SimpleDialog({ dialog, config, defaults, onClose, onAdd, onName, onRemove }: Props) {
  const t = useT();
  const duplicate = useDuplicateFolder(config, dialog.kind === 'add' ? dialog.path : '');
  const formId = useId();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstAccount = Object.keys(config.accounts)[0] ?? 'shared';
  const [name, setName] = useState(() => {
    if (dialog.kind === 'add') return folderName(dialog.path);
    if (dialog.kind === 'renameProject') return dialog.project.name;
    if (dialog.kind === 'renameGroup') return groupLabel(t, dialog.group);
    return '';
  });
  // Local projects: any group but the built-in Remote one.
  const localGroups = config.groups.filter((g) => fitsGroup(false, g.id));
  const [group, setGroup] = useState(() =>
    defaults.group && localGroups.some((g) => g.id === defaults.group)
      ? defaults.group
      : (localGroups[0]?.id ?? ''),
  );
  const [account, setAccount] = useState(() =>
    defaults.account && config.accounts[defaults.account] ? defaults.account : firstAccount,
  );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const cancel = (
    <Button variant="ghost" onClick={onClose}>
      {t('action.cancel')}
    </Button>
  );
  const submit = (label: string, disabled = false) => (
    <Button variant="primary" type="submit" form={formId} disabled={busy || disabled}>
      {label}
    </Button>
  );
  const errorLine = error && <p role="alert">{error}</p>;

  if (dialog.kind === 'removeProject') {
    return (
      <Dialog
        open
        title={t('projects.removeTitle', { name: dialog.project.name })}
        onClose={onClose}
        actions={
          <>
            {cancel}
            <Button variant="primary" onClick={() => run(onRemove)} disabled={busy} autoFocus>
              {t('projects.removeConfirm')}
            </Button>
          </>
        }
      >
        <p>{t('projects.removeBody')}</p>
        {dialog.sessions > 0 && <p>{t('projects.removeSessions', { count: String(dialog.sessions) })}</p>}
        {errorLine}
      </Dialog>
    );
  }

  if (dialog.kind === 'add') {
    return (
      <Dialog
        open
        title={t('projects.add')}
        onClose={onClose}
        actions={
          <>
            {cancel}
            {submit(t('action.add'))}
          </>
        }
      >
        <DialogForm id={formId} onSubmit={() => run(() => onAdd({ name, group, account }))}>
          <Field
            label={t('projects.name')}
            hint={dialog.path}
            warning={duplicate && `${dialog.path} · ${t('settings.duplicate', { name: duplicate })}`}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label={t('projects.group')}>
            <Select
              value={group}
              onChange={setGroup}
              options={localGroups.map((g) => ({ value: g.id, label: groupLabel(t, g) }))}
            />
          </Field>
          <Field label={t('account.title')}>
            <Select
              value={account}
              onChange={setAccount}
              options={Object.entries(config.accounts).map(([id, a]) => ({
                value: id,
                label: accountLabel(t, id, a),
              }))}
            />
          </Field>
        </DialogForm>
        {errorLine}
      </Dialog>
    );
  }

  const title =
    dialog.kind === 'renameProject'
      ? t('projects.renameTitle')
      : dialog.kind === 'renameGroup'
        ? t('groups.renameTitle')
        : t('groups.newTitle');
  // Renaming a group to blank resets it to its default name; everything else needs a name.
  const needsName = dialog.kind !== 'renameGroup';
  return (
    <Dialog
      open
      title={title}
      onClose={onClose}
      actions={
        <>
          {cancel}
          {submit(dialog.kind === 'newGroup' ? t('action.add') : t('action.save'), needsName && !name.trim())}
        </>
      }
    >
      <DialogForm id={formId} onSubmit={() => (!needsName || name.trim()) && run(() => onName(name))}>
        <Field label={t('projects.name')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            onFocus={(e) => e.target.select()}
          />
        </Field>
      </DialogForm>
      {errorLine}
    </Dialog>
  );
}
