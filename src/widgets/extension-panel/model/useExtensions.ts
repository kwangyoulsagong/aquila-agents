import { useEffect, useState } from 'react';
import { api, type ExtensionInfo, type ExtensionPermission } from '@/shared/api';
import type { Translate } from '@/shared/i18n';

type Key = Parameters<Translate>[0];

/** The extensions under ~/.aquila/extensions (T71), live. Null until main answered. */
export function useExtensions(): ExtensionInfo[] | null {
  const [list, setList] = useState<ExtensionInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    void api.extensionsList().then((l) => live && setList(l));
    const off = api.onExtensions((l) => live && setList(l));
    return () => {
      live = false;
      off();
    };
  }, []);
  return list;
}

/** The label of a permission in the review list. */
export const PERMISSION_KEY: Record<ExtensionPermission, Key> = {
  system: 'ext.perm.system',
  'sessions:status': 'ext.perm.sessions',
  usage: 'ext.perm.usage',
  storage: 'ext.perm.storage',
  notify: 'ext.perm.notify',
  background: 'ext.perm.background',
};

/** The one to show: the requested id when it's there, else the first. */
export function pickExtension(list: readonly ExtensionInfo[], id: string | null): ExtensionInfo | undefined {
  return list.find((e) => e.id === id) ?? list[0];
}

/** ⌘K items: one per manifest command of an enabled extension. */
export function extensionCommands(
  list: readonly ExtensionInfo[],
): { id: string; extensionId: string; commandId: string; name: string; title: string }[] {
  return list
    .filter((e) => e.valid && e.enabled)
    .flatMap((e) =>
      e.commands.map((c) => ({
        id: `ext:${e.id}:${c.id}`,
        extensionId: e.id,
        commandId: c.id,
        name: e.name,
        title: c.title,
      })),
    );
}
