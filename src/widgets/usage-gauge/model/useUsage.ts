import { useEffect, useState } from 'react';
import { api, type AccountUsage } from '@/shared/api';

/** Usage per account: read once on mount, then pushed by main (every minute while focused, after each turn). */
export function useUsage(): AccountUsage[] {
  const [list, setList] = useState<AccountUsage[]>([]);
  useEffect(() => {
    let alive = true;
    api
      .usage()
      .then((u) => alive && setList(u))
      .catch(() => {});
    const off = api.onUsage(setList);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return list;
}
