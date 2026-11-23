// Knowledge graph (T65): code names of the user's projects (file names, exported symbols), so a note that says
// `useWorkspace` or `apply.ts` connects to other notes that do — with no link written. Runs in the index worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CodeName } from './build';
import { codeish } from './parse';

/** Folders that are never the user's code. */
export const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'out',
  'release',
  'coverage',
  'vendor',
  'target',
  '__pycache__',
  'venv',
  'Pods',
  'DerivedData',
]);
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|vue|svelte)$/;
const EXPORTS: Partial<Record<string, RegExp>> = {
  js: /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/gm,
  py: /^(?:def|class)\s+([A-Za-z_]\w*)/gm,
  go: /^(?:func(?:\s*\([^)]*\))?|type)\s+([A-Z]\w*)/gm,
  rs: /^pub\s+(?:async\s+)?(?:fn|struct|enum|trait|type)\s+([A-Za-z_]\w*)/gm,
  java: /^\s*public\s+(?:static\s+)?(?:final\s+)?(?:class|interface|enum|record)\s+([A-Z]\w*)/gm,
  swift: /^(?:public\s+|open\s+)?(?:final\s+)?(?:class|struct|enum|protocol|func)\s+([A-Za-z_]\w*)/gm,
};
const LANG: Record<string, keyof typeof EXPORTS> = {
  ts: 'js',
  tsx: 'js',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  vue: 'js',
  svelte: 'js',
  py: 'py',
  go: 'go',
  rs: 'rs',
  java: 'java',
  kt: 'java',
  swift: 'swift',
};
const MAX_FILE_BYTES = 256 * 1024;

export interface CodeProject {
  id: string;
  root: string;
}

/** Yields to the event loop so a long scan doesn't hold the worker (status / stop messages get through). */
export const yieldNow = () => new Promise<void>((r) => setImmediate(r));

/**
 * File names (with and without extension) and exported symbols of each project, code-ish names only.
 * Capped per project; files over 256 KB are named but not read.
 */
export async function collectCodeNames(
  projects: readonly CodeProject[],
  maxFiles = 4000,
): Promise<Map<string, CodeName>> {
  const names = new Map<string, CodeName>();
  const add = (name: string, file: string, project: string) => {
    if (!codeish(name)) return;
    const prev = names.get(name);
    if (!prev) names.set(name, { path: file, projects: [project] });
    else if (!prev.projects.includes(project)) prev.projects.push(project);
  };
  for (const p of projects) {
    let seen = 0;
    const stack = [p.root];
    while (stack.length && seen < maxFiles) {
      const dir = stack.pop()!;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (e.name.startsWith('.')) continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) stack.push(abs);
          continue;
        }
        if (!e.isFile() || !CODE_FILE.test(e.name)) continue;
        if (++seen > maxFiles) break;
        add(e.name, abs, p.id);
        add(e.name.replace(/\.[^.]+$/, ''), abs, p.id);
        const lang = LANG[e.name.slice(e.name.lastIndexOf('.') + 1)];
        const re = lang && EXPORTS[lang];
        if (!re) continue;
        try {
          const stat = await fs.stat(abs);
          if (stat.size > MAX_FILE_BYTES) continue;
          const src = await fs.readFile(abs, 'utf8');
          for (const m of src.matchAll(re)) add(m[1], abs, p.id);
        } catch {
          // unreadable: the file name is enough
        }
        if (seen % 100 === 0) await yieldNow();
      }
    }
  }
  return names;
}
