import { currentTheme } from '@/shared/lib/theme';

export const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** xterm colors from the current tokens (re-read when the OS appearance changes). */
export const terminalTheme = () => ({
  background: token('--color-terminal-bg'),
  foreground: token('--color-terminal-fg'),
  cursor: token('--color-terminal-cursor'),
  selectionBackground: token('--color-terminal-selection'),
  scrollbarSliderBackground: token('--color-terminal-scrollbar'),
  scrollbarSliderHoverBackground: token('--color-terminal-scrollbar-hover'),
  scrollbarSliderActiveBackground: token('--color-terminal-scrollbar-hover'),
});

/**
 * CLIs pick their output colors for a dark background (Claude's default theme, ANSI white/yellow).
 * On light, xterm darkens any foreground below WCAG AA against its cell background.
 */
export const minimumContrast = () => (currentTheme() === 'light' ? 4.5 : 1);
