// User config at ~/.aquila/config.json. Created with defaults on first run.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PORT_BASE_MAX,
  PORT_BASE_MIN,
  type Config,
  type Group,
  type Language,
  type Project,
  type ProjectEdit,
  type ProjectSettings,
  type SessionKind,
} from '../src/shared/api/types';
import { translator } from '../src/shared/i18n/dictionary';

const HOME = os.homedir();
export const APP_DIR = path.join(HOME, '.aquila');
export const CONFIG_PATH = path.join(APP_DIR, 'config.json');
/** Where the app kept its files before it was renamed from Agentrix. */
const LEGACY_DIR = path.join(HOME, '.agentrix');

// Accounts: `shared` = plain `claude` (~/.claude), `personal` = `claude-personal` (~/.claude-personal).
// claudeConfigDir null = Claude default. Setting "~/.claude" explicitly would make Claude
// use a different keychain entry, so the shared account must stay null.
// Labels are omitted on purpose: the UI translates known ids (ko/en).
const DEFAULT_CONFIG: Config = {
  language: 'ko',
  accounts: {
    shared: { claudeConfigDir: null },
    personal: { claudeConfigDir: '~/.claude-personal' },
  },
  groups: [{ id: 'work' }, { id: 'personal' }],
  projects: [
    {
      id: 'data-bahn',
      name: 'data-bahn-fe-web',
      group: 'work',
      account: 'shared',
      path: '~/Desktop/PartridgeSystems/data-bahn-fe-web',
    },
    { id: 'salt', name: 'SALT', group: 'personal', account: 'shared', path: '~/Desktop/SALT' },
    {
      id: 'road-to-pro',
      name: 'Road-To-PRO',
      group: 'personal',
      account: 'personal',
      path: '~/Desktop/Road-To-PRO',
    },
    { id: 'devatlas', name: 'DevAtlas', group: 'personal', account: 'personal', path: '~/Desktop/DevAtlas' },
    {
      id: 'aquila',
      name: 'Aquila Agents',
      group: 'personal',
      account: 'shared',
      path: '~/Desktop/aquila-agents',
    },
  ],
};

export const expand = (p: string): string => (p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

/**
 * One-time move after the rename: copy ~/.agentrix (config, saved state) into ~/.aquila if there's no config yet.
 * The old folder is left in place. claude-hooks.json is skipped: it's regenerated on start.
 */
export function migrateLegacyDir(from = LEGACY_DIR, to = APP_DIR): boolean {
  const target = path.join(to, 'config.json');
  if (fs.existsSync(target) || !fs.existsSync(path.join(from, 'config.json'))) return false;
  fs.cpSync(from, to, {
    recursive: true,
    force: false,
    filter: (src) => path.basename(src) !== 'claude-hooks.json',
  });
  return true;
}

export function loadConfig(): Config {
  migrateLegacyDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(APP_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
  }
  try {
    const c = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Config;
    return { ...c, language: c.language === 'en' ? 'en' : 'ko' };
  } catch (err) {
    const t = translator(DEFAULT_CONFIG.language);
    return { ...DEFAULT_CONFIG, error: t('error.configRead', { message: (err as Error).message }) };
  }
}

function saveConfig(c: Config): Config {
  const { error: _ignored, ...rest } = c;
  void _ignored;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(rest, null, 2));
  return rest;
}

export function setLanguage(language: Language): Config {
  return saveConfig({ ...loadConfig(), language });
}

export function setProjectAccount(projectId: string, account: string): Config {
  const c = loadConfig();
  if (!c.accounts[account]) return c;
  return saveConfig({ ...c, projects: c.projects.map((p) => (p.id === projectId ? { ...p, account } : p)) });
}

// ── Project / group edits (sidebar UI) ────────────────────────────────────────

/** `~/…` for paths under home, so the config stays portable between machines. */
export function tildify(p: string, home = HOME): string {
  if (p === home) return '~';
  return p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
}

/** ASCII slug for ids; `fallback` when nothing is left (e.g. a Korean name). */
export function slugify(s: string, fallback: string): string {
  const slug = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function uniqueId(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

const move = <T>(list: T[], from: number, to: number): T[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
};

/** Puts `project` into `group` at `index` among that group's projects; the flat order elsewhere is kept. */
function placeProject(projects: Project[], project: Project, group: string, index: number): Project[] {
  const rest = projects.filter((p) => p.id !== project.id);
  const members = rest.filter((p) => p.group === group);
  const moved = { ...project, group };
  if (members.length === 0) return [...rest, moved];
  const anchor =
    index < members.length ? rest.indexOf(members[Math.max(0, index)]) : rest.indexOf(members.at(-1)!) + 1;
  return [...rest.slice(0, anchor), moved, ...rest.slice(anchor)];
}

const KINDS: SessionKind[] = ['claude', 'codex', 'shell'];

/** An optional text setting: trimmed; blank removes the key. */
function setText<K extends 'defaultBranch' | 'setupScript' | 'openIn'>(p: Project, key: K, value: string): Project {
  const v = key === 'setupScript' ? value.replace(/\s+$/, '') : value.trim();
  return v.trim() ? { ...p, [key]: v } : dropKey(p, key);
}

function dropKey(p: Project, key: keyof Project): Project {
  const { [key]: _old, ...rest } = p;
  void _old;
  return rest as Project;
}

/** Settings dialog → project. Invalid values (unknown group/account, bad port, blank name) are ignored. */
export function applySettings(
  p: Project,
  s: ProjectSettings,
  ctx: { hasGroup: (id: string) => boolean; hasAccount: (id: string) => boolean; home: string },
): Project {
  let next: Project = { ...p };
  const name = s.name?.trim();
  if (name) next.name = name;
  if (s.group && ctx.hasGroup(s.group)) next.group = s.group;
  if (s.account && ctx.hasAccount(s.account)) next.account = s.account;
  if (s.path?.trim()) next.path = tildify(s.path.trim(), ctx.home);
  if (s.defaultAgent === null || s.defaultAgent === 'claude') next = dropKey(next, 'defaultAgent');
  else if (s.defaultAgent && KINDS.includes(s.defaultAgent)) next.defaultAgent = s.defaultAgent;
  if (s.portBase === null) next = dropKey(next, 'portBase');
  else if (
    typeof s.portBase === 'number' &&
    Number.isInteger(s.portBase) &&
    s.portBase >= PORT_BASE_MIN &&
    s.portBase <= PORT_BASE_MAX
  )
    next.portBase = s.portBase;
  if (s.defaultBranch !== undefined) next = setText(next, 'defaultBranch', s.defaultBranch);
  if (s.setupScript !== undefined) next = setText(next, 'setupScript', s.setupScript);
  if (s.openIn !== undefined) next = setText(next, 'openIn', s.openIn);
  return next;
}

/** Id of the project whose folder is `dir` (`~/…` or absolute, trailing slash ignored), else null. */
export function projectForPath(c: Config, dir: string, home = HOME): string | null {
  const norm = (p: string) => {
    const abs = p.startsWith('~') ? path.join(home, p.slice(1)) : p;
    return path.resolve(abs).replace(/\/+$/, '') || '/';
  };
  const target = norm(dir);
  return c.projects.find((p) => norm(p.path) === target)?.id ?? null;
}

/** Opens the project folder with its "Open in" app (`open -a`), or in Finder when none is set. */
export function openProjectIn(c: Config, projectId: string): Promise<void> {
  const project = c.projects.find((p) => p.id === projectId);
  if (!project) return Promise.reject(new Error(translator(c.language)('error.projectNotFound', { id: projectId })));
  const dir = expand(project.path);
  const args = project.openIn ? ['-a', project.openIn, dir] : [dir];
  return new Promise((resolve, reject) =>
    execFile('open', args, (err, _out, stderr) =>
      err ? reject(new Error(String(stderr).trim() || err.message)) : resolve(),
    ),
  );
}

/** Applies one sidebar edit. Pure: unknown ids and invalid values leave the config unchanged. */
export function applyProjectEdit(c: Config, e: ProjectEdit, home = HOME): Config {
  const hasGroup = (id: string) => c.groups.some((g) => g.id === id);
  const hasAccount = (id: string) => Boolean(c.accounts[id]);
  switch (e.op) {
    case 'addProject': {
      const name = e.name.trim() || path.basename(e.path) || e.path;
      const groups: Group[] = c.groups.length ? c.groups : [{ id: 'work' }];
      const group = groups.some((g) => g.id === e.group) ? e.group : groups[0].id;
      const account = hasAccount(e.account) ? e.account : (Object.keys(c.accounts)[0] ?? 'shared');
      const id = uniqueId(
        slugify(name, 'project'),
        c.projects.map((p) => p.id),
      );
      const project: Project = { id, name, group, account, path: tildify(e.path, home) };
      return { ...c, groups, projects: placeProject(c.projects, project, group, Infinity) };
    }
    case 'updateProject': {
      const { op: _op, id, ...settings } = e;
      void _op;
      return {
        ...c,
        projects: c.projects.map((p) =>
          p.id === id ? applySettings(p, settings, { hasGroup, hasAccount, home }) : p,
        ),
      };
    }
    case 'removeProject':
      return { ...c, projects: c.projects.filter((p) => p.id !== e.id) };
    case 'moveProject': {
      const project = c.projects.find((p) => p.id === e.id);
      if (!project || !hasGroup(e.group)) return c;
      return { ...c, projects: placeProject(c.projects, project, e.group, e.index) };
    }
    case 'addGroup': {
      const label = e.label.trim();
      if (!label) return c;
      const id = uniqueId(
        slugify(label, 'group'),
        c.groups.map((g) => g.id),
      );
      return { ...c, groups: [...c.groups, { id, label }] };
    }
    case 'renameGroup': {
      const label = e.label.trim();
      return {
        ...c,
        groups: c.groups.map((g) => {
          if (g.id !== e.id) return g;
          if (label) return { ...g, label };
          const { label: _dropped, ...rest } = g;
          void _dropped;
          return rest;
        }),
      };
    }
    case 'removeGroup':
      if (c.projects.some((p) => p.group === e.id)) return c;
      return { ...c, groups: c.groups.filter((g) => g.id !== e.id) };
    case 'moveGroup': {
      const from = c.groups.findIndex((g) => g.id === e.id);
      return from < 0 ? c : { ...c, groups: move(c.groups, from, e.index) };
    }
  }
}

export function editProjects(edit: ProjectEdit): Config {
  const c = loadConfig();
  // A config we couldn't read must not be overwritten with the defaults.
  if (c.error) throw new Error(c.error);
  return saveConfig(applyProjectEdit(c, edit));
}
