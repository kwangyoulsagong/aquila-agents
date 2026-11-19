// User config at ~/.aquila/config.json. Created with defaults on first run.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config, Language } from '../src/shared/api/types';
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
