// User config at ~/.aquila/config.json. Created with defaults on first run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config, Group, Language, Project, ProjectEdit } from '../src/shared/api/types';
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
      const name = e.name?.trim();
      return {
        ...c,
        projects: c.projects.map((p) =>
          p.id !== e.id
            ? p
            : {
                ...p,
                ...(name ? { name } : {}),
                ...(e.group && hasGroup(e.group) ? { group: e.group } : {}),
                ...(e.account && hasAccount(e.account) ? { account: e.account } : {}),
              },
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
