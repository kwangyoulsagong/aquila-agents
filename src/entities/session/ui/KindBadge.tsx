import { Badge } from '@design-system/react';
import type { SessionKind } from '@/shared/api';

export default function KindBadge({ kind }: { kind: SessionKind }) {
  return <Badge tone={kind}>{kind}</Badge>;
}
