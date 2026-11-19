import { Dot } from '@design-system/react';
import type { SessionStatus } from '@/shared/api';

export default function StatusDot({ status }: { status: SessionStatus }) {
  return <Dot status={status} />;
}
