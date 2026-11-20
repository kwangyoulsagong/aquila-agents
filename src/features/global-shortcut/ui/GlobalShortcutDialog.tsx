import { useEffect, useState, type KeyboardEvent } from 'react';
import { Button, Dialog, Field, Input } from '@design-system/react';
import { api, type GlobalShortcutState } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { acceleratorLabel, detectPlatform } from '@/shared/lib/shortcuts';
import { recordKey, type Recorded } from '../model/record';

const PLATFORM = detectPlatform();

type Problem = Exclude<Recorded['kind'], 'partial' | 'ok'> | 'taken' | 'invalid';

/**
 * Settings ▸ Global shortcut (T41): click the field, press a combo, save. Saving registers it with the OS right away;
 * a key another app holds is reported and the old one stays. Off by default.
 */
export default function GlobalShortcutDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [state, setState] = useState<GlobalShortcutState | null>(null);
  /** Recorded and accepted, not saved yet. */
  const [draft, setDraft] = useState<string | null>(null);
  /** Modifiers held while recording (shown until a key comes). */
  const [held, setHeld] = useState<string[]>([]);
  const [problem, setProblem] = useState<{ kind: Problem; key?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.globalShortcut().then((s) => {
      setState(s);
      if (s.error && s.accelerator) setProblem({ kind: s.error, key: s.accelerator });
    });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    // Esc closes the dialog and Tab moves focus, as everywhere else.
    if (plain && (e.key === 'Escape' || e.key === 'Tab')) return;
    e.preventDefault();
    // Keep the workspace's own shortcuts out while recording.
    e.stopPropagation();
    const r = recordKey(e.nativeEvent, PLATFORM);
    if (r.kind === 'partial') return setHeld(r.modifiers);
    setHeld([]);
    if (r.kind === 'ok') {
      setDraft(r.accelerator);
      setProblem(null);
    } else {
      setDraft(null);
      setProblem({ kind: r.kind });
    }
  };

  const save = async (accelerator: string | null) => {
    setBusy(true);
    try {
      const next = await api.setGlobalShortcut(accelerator);
      setState(next);
      if (next.error) setProblem({ kind: next.error, key: next.failed ?? next.accelerator ?? undefined });
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  const shown = held.length ? [...held, ''].join('+') : (draft ?? state?.accelerator ?? null);
  const value = shown ? acceleratorLabel(shown, PLATFORM) : '';
  const mods = PLATFORM === 'mac' ? '⌘ ⌃ ⌥' : 'Ctrl / Alt';
  const warning =
    problem &&
    t(`globalShortcut.error.${problem.kind}`, {
      mods,
      key: problem.key ? acceleratorLabel(problem.key, PLATFORM) : '',
    });
  const status = state?.accelerator
    ? t(state.active ? 'globalShortcut.on' : 'globalShortcut.inactive', {
        key: acceleratorLabel(state.accelerator, PLATFORM),
      })
    : t('globalShortcut.off');

  return (
    <Dialog
      open
      title={t('globalShortcut.title')}
      onClose={onClose}
      actions={
        <>
          {state?.accelerator && (
            <Button variant="ghost" onClick={() => void save(null)} disabled={busy}>
              {t('globalShortcut.turnOff')}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => draft && void save(draft)}
            disabled={busy || !draft || (draft === state?.accelerator && state.active)}
          >
            {t('globalShortcut.save')}
          </Button>
        </>
      }
    >
      <p>{t('globalShortcut.body')}</p>
      <Field label={t('globalShortcut.key')} hint={status} warning={warning}>
        <Input
          readOnly
          autoFocus
          value={value}
          placeholder={t('globalShortcut.placeholder')}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if (!e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) setHeld([]);
          }}
          onBlur={() => setHeld([])}
        />
      </Field>
    </Dialog>
  );
}
