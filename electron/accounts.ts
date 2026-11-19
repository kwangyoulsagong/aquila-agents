// Claude account setup: is each account's config dir there and logged in, create it, and the optional
// zsh function (`claude-personal`) — the ONLY place the app may write to an rc file (explicit click, previewed first).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expand } from './config';
import type { AccountStatus, Config, ShellFunctionPreview } from '../src/shared/api/types';

const HOME = os.homedir();
const ZSHRC = path.join(HOME, '.zshrc');

/** `.claude.json` holds `oauthAccount` once `/login` finished. */
export function isLoggedIn(claudeJson: string | null): boolean {
  if (!claudeJson) return false;
  try {
    const parsed = JSON.parse(claudeJson) as { oauthAccount?: unknown };
    return Boolean(parsed.oauthAccount);
  } catch {
    return false;
  }
}

const readOrNull = (file: string): string | null => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** Config dir and `.claude.json` for an account. Shared (dir null) = Claude default: ~/.claude + ~/.claude.json. */
export function accountPaths(dir: string | null): { dir: string; claudeJson: string } {
  if (!dir) return { dir: path.join(HOME, '.claude'), claudeJson: path.join(HOME, '.claude.json') };
  const abs = expand(dir);
  return { dir: abs, claudeJson: path.join(abs, '.claude.json') };
}

export function accountsStatus(config: Config): Record<string, AccountStatus> {
  return Object.fromEntries(
    Object.entries(config.accounts).map(([id, a]) => {
      const p = accountPaths(a.claudeConfigDir);
      return [id, { configDirExists: fs.existsSync(p.dir), loggedIn: isLoggedIn(readOrNull(p.claudeJson)) }];
    }),
  );
}

/**
 * Create the account's config dir so Claude can log in there. Only dirs named `.claude*` directly under $HOME,
 * so a hand-edited config can't make us create something elsewhere.
 */
export function prepareAccount(config: Config, id: string): AccountStatus {
  const a = config.accounts[id];
  if (!a) throw new Error(`Unknown account: ${id}`);
  if (a.claudeConfigDir) {
    const dir = expand(a.claudeConfigDir);
    if (path.dirname(dir) !== HOME || !path.basename(dir).startsWith('.claude'))
      throw new Error(`Refusing to create ${dir}: expected ~/.claude-<name>`);
    fs.mkdirSync(dir, { recursive: true });
  }
  return accountsStatus(config)[id];
}

/** Shell name for an account's function: `claude-<id>` (`claude-personal`). */
export const functionName = (id: string): string => `claude-${id}`;

/** The line we append. `~/x` becomes `$HOME/x` so the snippet reads like something you'd write by hand. */
export function shellSnippet(id: string, configDir: string): string {
  const dir = configDir.startsWith('~/') ? `$HOME/${configDir.slice(2)}` : configDir;
  return `${functionName(id)}() { CLAUDE_CONFIG_DIR="${dir}" command claude "$@"; }`;
}

/** True if the rc text already defines the name as a function or alias. */
export function definedInRc(rc: string, name: string): boolean {
  const n = name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(`^\\s*(function\\s+${n}\\b|${n}\\s*\\(\\s*\\)|alias\\s+${n}=)`, 'm').test(rc);
}

/** Ask an interactive zsh — catches definitions in files ~/.zshrc sources. */
function definedInShell(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('/bin/zsh', ['-i', '-c', `whence -w -- ${name}`], { timeout: 5000 }, (err) => resolve(!err));
  });
}

function shellAccount(config: Config, id: string): string {
  const dir = config.accounts[id]?.claudeConfigDir;
  if (!dir) throw new Error(`Account ${id} has no config dir`);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`Account id not usable as a shell name: ${id}`);
  if (/["`$\\]/.test(dir)) throw new Error(`Config dir not safe to quote: ${dir}`);
  return dir;
}

export async function shellFunctionPreview(config: Config, id: string): Promise<ShellFunctionPreview> {
  const dir = shellAccount(config, id);
  const name = functionName(id);
  const defined = definedInRc(readOrNull(ZSHRC) ?? '', name) || (await definedInShell(name));
  return { name, rcPath: '~/.zshrc', snippet: shellSnippet(id, dir), defined };
}

/** Append the function to ~/.zshrc unless it's already defined. Called only from an explicit, previewed click. */
export async function installShellFunction(config: Config, id: string): Promise<ShellFunctionPreview> {
  const preview = await shellFunctionPreview(config, id);
  if (preview.defined) return preview;
  const rc = readOrNull(ZSHRC) ?? '';
  const sep = rc === '' || rc.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(
    ZSHRC,
    `${sep}\n# Added by Aquila Agents: Claude with the ${id} account\n${preview.snippet}\n`,
  );
  return { ...preview, defined: true };
}
