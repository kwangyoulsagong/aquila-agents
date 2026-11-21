import { useEffect, useState } from 'react';
import { Badge, Button, PickItem, PickList } from '@design-system/react';
import { api, type RemoteDirList, type RemoteHost } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { childDir, parentDir } from '../model/remote';

interface Props {
  host: RemoteHost;
  /** Folder to start in (the path field; `~/` = home). */
  start: string;
  onPick: (path: string) => void;
}

/** Remote folder picker (T56): the folders of one directory on the host (read-only `ls`), up, "Use this folder". */
export default function RemoteFolderPicker({ host, start, onPick }: Props) {
  const t = useT();
  const [dir, setDir] = useState(start.trim() || '~');
  const [list, setList] = useState<RemoteDirList | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setList(null);
    setError(null);
    api
      .listRemoteDirs(host, dir)
      .then((l) => {
        if (!live) return;
        // A typed folder that isn't there: fall back to home instead of a dead end.
        if (!l.exists && dir !== '~') setDir('~');
        else setList(l);
      })
      .catch((e: unknown) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
    // host is a fresh object per render; its fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host.alias, host.claudeConfigDir, dir]);

  const path = list?.path ?? dir;
  const empty = error ?? (!list ? t('remote.loading') : list.dirs.length ? undefined : t('remote.noFolders'));
  return (
    <PickList
      label={t('remote.browseLabel')}
      path={path}
      empty={empty}
      actions={
        <>
          <Button variant="ghost" disabled={!list || path === '/'} onClick={() => setDir(parentDir(path))}>
            {t('remote.up')}
          </Button>
          <Button disabled={!list} onClick={() => onPick(path)}>
            {t('remote.useFolder')}
          </Button>
        </>
      }
    >
      {list?.dirs.map((d) => (
        <PickItem
          key={d.name}
          onClick={() => setDir(childDir(path, d.name))}
          trailing={d.repo ? <Badge>{t('remote.repo')}</Badge> : undefined}
        >
          {d.name}
        </PickItem>
      ))}
    </PickList>
  );
}
