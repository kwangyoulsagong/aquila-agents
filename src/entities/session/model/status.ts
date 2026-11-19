import type { SessionStatus } from '@/shared/api';

// Most urgent first. A project row shows the most urgent status among its sessions.
const PRIORITY: SessionStatus[] = ['waiting', 'error', 'working', 'done', 'stopped', 'idle'];

export function mostUrgent(statuses: SessionStatus[]): SessionStatus {
  return PRIORITY.find((s) => statuses.includes(s)) ?? 'idle';
}
