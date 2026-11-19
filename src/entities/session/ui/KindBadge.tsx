import type { SessionKind } from '@/shared/api';

export default function KindBadge({ kind }: { kind: SessionKind }) {
  return <span className={`c-badge c-badge--${kind}`}>{kind}</span>;
}
