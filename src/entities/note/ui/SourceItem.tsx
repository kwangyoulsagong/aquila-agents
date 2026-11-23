import type { ReactNode } from 'react';
import { ChecklistItem, Dot } from '@design-system/react';
import type { GraphSourceStatus } from '@/shared/api';
import { useT } from '@/shared/i18n';
import { sourceDot, sourceLine, sourceName } from '../model/source';

/** One note source (T65): state dot · folder name / path · what it's doing, with buttons on the right. */
export default function SourceItem({ source, actions }: { source: GraphSourceStatus; actions?: ReactNode }) {
  const t = useT();
  const line = sourceLine(t, source);
  return (
    <ChecklistItem
      leading={<Dot status={sourceDot(source.state)} label={line} />}
      title={sourceName(source.path)}
      meta={`${line} · ${source.path}`}
      actions={actions}
    />
  );
}
