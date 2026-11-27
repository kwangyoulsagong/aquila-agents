import { useEffect, useState } from 'react';
import { api, type VaultProperty } from '@/shared/api';

/** The property types the note's source declares (T69 settings), asked again when they change; none without. */
export function useDeclared(path: string): VaultProperty[] {
  const [props, setProps] = useState<VaultProperty[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void api.vaultNoteInfo(path).then((i) => alive && setProps(i?.properties ?? []));
    load();
    const off = api.onVaultChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [path]);
  return props;
}
