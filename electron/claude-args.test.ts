import { describe, expect, it } from 'vitest';
import { PLAN_ARGS } from './apply';
import { briefArgs } from './brief';
import { haikuArgs } from './graph/extract';
import { SUMMARY_ARGS } from './news';

/** The value(s) after `flag` up to the next `--option`. */
const after = (args: readonly string[], flag: string) => {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  const rest = args.slice(i + 1);
  const end = rest.findIndex((a) => a.startsWith('--'));
  return rest.slice(0, end < 0 ? undefined : end);
};

describe('hidden claude runs', () => {
  const runs: [string, readonly string[]][] = [
    ['brief', briefArgs({ model: 'haiku' })],
    ['brief + figma', briefArgs({ model: 'haiku', figmaMcp: '/x/figma.json' })],
    ['graph extraction', haikuArgs('haiku')],
    ['make with claude', haikuArgs('sonnet')],
    ['news summary', SUMMARY_ARGS],
    ['apply analysis', PLAN_ARGS],
  ];

  it.each(runs)('%s: strict MCP, no Bash/Edit/Write/WebFetch', (_name, args) => {
    expect(args[0]).toBe('-p');
    expect(args).toContain('--strict-mcp-config');
    const tools = after(args, '--tools');
    expect(tools).toHaveLength(1);
    expect(tools?.[0]).not.toMatch(/Bash|Edit|Write|WebFetch|WebSearch|default/);
    expect(args.join(' ')).not.toMatch(/bypassPermissions|dangerously/);
  });

  it('only the brief with Figma loads an MCP config; the others none', () => {
    for (const [name, args] of runs) expect(args.includes('--mcp-config')).toBe(name === 'brief + figma');
  });

  it('text-only runs get no tools at all; the analysis only reads', () => {
    for (const args of [briefArgs({ model: 'haiku' }), haikuArgs('haiku'), SUMMARY_ARGS])
      expect(after(args, '--tools')).toEqual(['']);
    expect(after(PLAN_ARGS, '--tools')).toEqual(['Read,Glob,Grep']);
    expect(after(PLAN_ARGS, '--permission-mode')).toEqual(['plan']);
  });
});
