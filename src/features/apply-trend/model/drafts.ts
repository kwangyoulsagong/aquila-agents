import type { ApplyStep } from '@/shared/api';

/** A proposal step as the user edits it: ticked or not, title rewritten or not. */
export interface StepDraft {
  step: ApplyStep;
  on: boolean;
  title: string;
}

export const draftsOf = (steps: ApplyStep[]): StepDraft[] =>
  steps.map((step) => ({ step, on: true, title: step.title }));

/** The ticked steps with their (trimmed, non-empty) titles: what Apply pastes and Analyse again builds on. */
export const keptSteps = (drafts: StepDraft[]): ApplyStep[] =>
  drafts.filter((d) => d.on).map((d) => ({ ...d.step, title: d.title.trim() || d.step.title }));

/** Nodes of one step, for the graph's hover highlight. */
export const stepNodes = (drafts: StepDraft[], id: string | null): string[] =>
  (id && drafts.find((d) => d.step.id === id)?.step.nodes) || [];
