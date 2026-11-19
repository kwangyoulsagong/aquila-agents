import type { PickResult } from '@/shared/api';

export interface PickLabels {
  intro: string;
  page: string;
  element: string;
  component: string;
  text: string;
  attrs: string;
  size: string;
  styles: string;
  screenshot: string;
}

/**
 * The picked element as one prompt for Claude or Codex: where it is, what it is, how it looks. The screenshot path is
 * pasted separately right after (a paste that is only an image path is what the CLIs attach as an image).
 */
export function buildPickPrompt(pick: PickResult, labels: PickLabels): string {
  const lines = [labels.intro, `${labels.page}: ${pick.url}`, `${labels.element}: \`${pick.selector}\``];
  if (pick.components.length) {
    const chain = pick.components.join(' ← ');
    lines.push(`${labels.component}: ${chain}${pick.source ? ` (${pick.source})` : ''}`);
  }
  if (pick.text) lines.push(`${labels.text}: "${pick.text}"`);
  const attrs = Object.entries(pick.attrs).map(([k, v]) => `${k}="${v}"`);
  if (attrs.length) lines.push(`${labels.attrs}: ${attrs.join(' ')}`);
  lines.push(`${labels.size}: ${Math.round(pick.rect.width)}×${Math.round(pick.rect.height)}`);
  const styles = Object.entries(pick.styles).map(([k, v]) => `${k}: ${v}`);
  if (styles.length) lines.push(`${labels.styles}: ${styles.join('; ')}`);
  if (pick.imagePath) lines.push(labels.screenshot);
  return lines.join('\n');
}
