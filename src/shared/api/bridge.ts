// The renderer's only door to the main process. Never touch window.agentrix elsewhere.
import type { AgentrixApi } from './types';

export const api: AgentrixApi = window.agentrix;
