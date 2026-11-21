import {
  PORT_BASE_MAX,
  PORT_BASE_MIN,
  type Project,
  type ProjectSettings,
  type RunCommand,
  type SessionKind,
} from '@/shared/api';

/** macOS apps offered for "Open in" (`open -a <name>`). '' = Finder. */
export const EDITORS = [
  'Visual Studio Code',
  'Cursor',
  'Zed',
  'WebStorm',
  'IntelliJ IDEA',
  'Sublime Text',
  'Xcode',
  'Terminal',
  'iTerm',
] as const;

/** Editor choices for a project: the presets, plus its own app if it's not one of them. */
export function editorOptions(current: string | undefined): string[] {
  return current && !(EDITORS as readonly string[]).includes(current) ? [...EDITORS, current] : [...EDITORS];
}

/** The dialog's editable values, all as form strings. */
export interface SettingsForm {
  name: string;
  path: string;
  group: string;
  account: string;
  defaultAgent: SessionKind;
  defaultBranch: string;
  setupScript: string;
  portBase: string;
  openIn: string;
  /** Remote projects only (T29). */
  remoteAlias: string;
  remoteClaudeDir: string;
  /** Figma MCP (T32), local projects only. */
  figma: boolean;
  /** Run slot commands (T60), one per line: `name: command` or just `command`. */
  runCommands: string;
}

/** `web: npm run dev` → named; a line without a `name: ` prefix is named after itself (`npm run dev:web` stays whole). */
const NAMED = /^([\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}):\s+(\S.*)$/u;

export function parseRunCommands(text: string): RunCommand[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = NAMED.exec(line);
      return m ? { name: m[1].trim(), command: m[2].trim() } : { name: line, command: line };
    });
}

export function formatRunCommands(list: readonly RunCommand[] | undefined): string {
  return (list ?? []).map((c) => (c.name === c.command ? c.command : `${c.name}: ${c.command}`)).join('\n');
}

export function toForm(p: Project): SettingsForm {
  return {
    name: p.name,
    path: p.path,
    group: p.group,
    account: p.account,
    defaultAgent: p.defaultAgent ?? 'claude',
    defaultBranch: p.defaultBranch ?? '',
    setupScript: p.setupScript ?? '',
    portBase: p.portBase === undefined ? '' : String(p.portBase),
    openIn: p.openIn ?? '',
    remoteAlias: p.remote?.alias ?? '',
    remoteClaudeDir: p.remote?.claudeConfigDir ?? '',
    figma: !!p.figma,
    runCommands: formatRunCommands(p.runCommands),
  };
}

/** Blank = no port base; otherwise an integer in range, or null when invalid. */
export function parsePort(text: string): number | undefined | null {
  const v = text.trim();
  if (!v) return undefined;
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= PORT_BASE_MIN && n <= PORT_BASE_MAX ? n : null;
}

/** Form → the edit sent to main. Only a changed path is sent (it's absolute from the folder picker). */
export function toSettings(form: SettingsForm, original: Project): ProjectSettings {
  const port = parsePort(form.portBase);
  return {
    name: form.name,
    group: form.group,
    account: form.account,
    ...(form.path !== original.path ? { path: form.path } : {}),
    defaultAgent: form.defaultAgent,
    defaultBranch: form.defaultBranch,
    setupScript: form.setupScript,
    portBase: port ?? null,
    openIn: form.openIn,
    ...(original.remote ? {} : { figma: form.figma, runCommands: parseRunCommands(form.runCommands) }),
    ...(original.remote
      ? { remote: { alias: form.remoteAlias.trim(), claudeConfigDir: form.remoteClaudeDir.trim() } }
      : {}),
  };
}
