import type { AgentrixApi } from '@/shared/api';

declare global {
  interface Window {
    agentrix: AgentrixApi;
  }
}

export {};
