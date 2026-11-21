// Destructive-command detection for a waiting session's summary ("Bash: rm -rf dist") — T52.
// A hint for the eye, not a guard: false negatives are fine, false positives on ordinary commands are not.

const PATTERNS: RegExp[] = [
  // rm with a recursive or force flag in any order: -rf, -fr, -r, -Rf, --recursive, --force
  /\brm\s+(?:-[a-zA-Z]*[rRf][a-zA-Z]*|--recursive|--force)\b/,
  /\bgit\s+push\b[^\n]*(?:\s--force(?:-with-lease)?\b|\s-f\b|\s\+\S)/,
  /\bgit\s+reset\b[^\n]*--hard\b/,
  /\bgit\s+clean\b[^\n]*\s-[a-zA-Z]*f/,
  /\bgit\s+branch\b[^\n]*\s-D\b/,
  /\bgit\s+(?:checkout|restore)\s+(?:--\s+)?\.(?:\s|$)/,
  /\b(?:drop|truncate)\s+(?:table|database|schema)\b/i,
  /\bdelete\s+from\b(?![^\n]*\bwhere\b)/i,
  /\bmigrate\s+reset\b/,
  /\b(?:db|database):?\s*(?:reset|drop)\b/,
  /\bterraform\s+destroy\b/,
  /\bkubectl\s+delete\b/,
  /\bmkfs(?:\.\w+)?\b/,
  /\bdd\s+[^\n]*\bof=\/dev\//,
  /\bchmod\s+-R\s+777\b/,
  /--force\b/,
];

/** True when the text looks like a destructive command (rm -rf, push --force, reset --hard, DROP TABLE…). */
export function isDestructive(text: string | undefined): boolean {
  if (!text) return false;
  return PATTERNS.some((re) => re.test(text));
}
