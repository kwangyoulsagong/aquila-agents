// Release notes pipeline (T27). Runs with Node's built-in type stripping (no build step):
//   node scripts/release-notes.ts draft [version]   → release-notes/<version>.json from Conventional Commits since
//                                                      the last tag; English titles from `feat` subjects, rest TODO
//   node scripts/release-notes.ts check [version]   → fails unless the notes are complete in ko + en, 3–5 headlines,
//                                                      each pointing at a guide item that has captured media
// `version` defaults to package.json's. `npm run dist` runs `check` first, so packaging fails without notes.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { draftNotes, parseNotes } from '../src/features/release-notes/model/notes.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const NOTES_DIR = path.join(ROOT, 'release-notes');
const REGISTRY = path.join(ROOT, 'src/features/guide/model/registry.ts');
const MEDIA_DIR = path.join(ROOT, 'src/features/guide/media');

const notesFile = (version: string) => path.join(NOTES_DIR, `${version}.json`);
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function packageVersion(): string {
  return (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string })
    .version;
}

/** Guide item ids, read from the registry source (`id: 'split'`). */
function guideIds(): Set<string> {
  return new Set([...fs.readFileSync(REGISTRY, 'utf8').matchAll(/\bid: '([\w-]+)'/g)].map((m) => m[1]));
}

function check(version: string): string[] {
  const file = notesFile(version);
  if (!fs.existsSync(file))
    return [`${path.relative(ROOT, file)} is missing — run \`npm run release-notes -- draft\` and edit it`];
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return [`invalid JSON: ${(e as Error).message}`];
  }
  const { notes, errors } = parseNotes(raw, version);
  if (!notes) return errors;
  const ids = guideIds();
  for (const [i, h] of notes.headlines.entries()) {
    if (!ids.has(h.guideId)) errors.push(`headlines[${i}].guideId "${h.guideId}" is not a guide item`);
    const media = h.media ?? h.guideId;
    for (const lang of ['ko', 'en'])
      if (!fs.existsSync(path.join(MEDIA_DIR, `${media}.${lang}.webp`)))
        errors.push(`headlines[${i}]: no guide media "${media}.${lang}.webp" (run \`npm run capture\`)`);
  }
  return errors;
}

function draft(version: string): void {
  const file = notesFile(version);
  if (fs.existsSync(file)) {
    console.error(`${path.relative(ROOT, file)} exists already — edit it, or delete it to draft again.`);
    process.exit(1);
  }
  let range = 'HEAD';
  try {
    range = `${git('describe', '--tags', '--abbrev=0')}..HEAD`;
  } catch {
    // No tag yet: every commit.
  }
  const subjects = git('log', '--no-merges', '--format=%s', range).split('\n').filter(Boolean);
  const notes = draftNotes(subjects, version, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(NOTES_DIR, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(notes, null, 2)}\n`);
  const feats = subjects.filter((s) => s.startsWith('feat')).length;
  const fixes = subjects.filter((s) => s.startsWith('fix')).length;
  console.log(`Drafted ${path.relative(ROOT, file)} from ${range}: ${feats} feat, ${fixes} fix commits.`);
  // The draft holds the newest five; every feature is listed so the right ones can be picked.
  for (const s of subjects.filter((s) => s.startsWith('feat'))) console.log(`  ${s}`);
  console.log('Pick 3–5 headlines, write ko + en, set each guideId, then `npm run release-notes -- check`.');
}

const [cmd, version = packageVersion()] = process.argv.slice(2);
if (cmd === 'draft') draft(version);
else if (cmd === 'check') {
  const errors = check(version);
  if (errors.length) {
    console.error(`Release notes for ${version} are not ready:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Release notes for ${version}: OK`);
} else {
  console.error('usage: node scripts/release-notes.ts draft|check [version]');
  process.exit(2);
}
