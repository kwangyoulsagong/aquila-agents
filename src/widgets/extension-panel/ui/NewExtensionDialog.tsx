import { useId, useState } from 'react';
import { Button, Dialog, DialogForm, Field, Input } from '@design-system/react';
import { api, type ExtensionCreated } from '@/shared/api';
import { useT } from '@/shared/i18n';

interface Props {
  /** Where the folder goes in the sidebar, and the account its Claude tab uses. */
  group: string;
  account: string;
  onClose: () => void;
  onCreated: (created: ExtensionCreated) => void;
}

/** "New extension" (T71): a name → a template folder (manifest, page, client, AGENTS.md) added as a project. */
export default function NewExtensionDialog({ group, account, onClose, onCreated }: Props) {
  const t = useT();
  const formId = useId();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    api
      .extensionsCreate(name.trim(), group, account)
      .then(onCreated)
      .catch((e: unknown) => {
        setError((e as Error).message);
        setBusy(false);
      });
  };
  return (
    <Dialog
      open
      title={t('ext.newTitle')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('action.cancel')}</Button>
          <Button variant="primary" type="submit" form={formId} disabled={!name.trim() || busy}>
            {t('ext.create')}
          </Button>
        </>
      }
    >
      <DialogForm id={formId} onSubmit={submit}>
        <Field label={t('ext.newName')} hint={t('ext.newHint')}>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('ext.newPlaceholder')}
            maxLength={40}
            autoFocus
          />
        </Field>
      </DialogForm>
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
