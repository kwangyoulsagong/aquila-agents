import type { SessionStatus } from '@/shared/api';

export default function StatusDot({ status }: { status: SessionStatus }) {
  return <i className="c-dot" data-status={status} />;
}
