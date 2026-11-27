import { describe, expect, it } from 'vitest';
import type { GraphEdge } from '../../src/shared/api/types';
import {
  applyRuleOp,
  cleanPattern,
  covers,
  decide,
  emptyLinks,
  patternsOf,
  proposals,
  ruleFor,
  withLink,
  type LinkData,
} from './rules';

const idEdge = (a: string, b: string, id: string): GraphEdge => ({
  id: `${a}→${b}`,
  source: a,
  target: b,
  kind: 'mention',
  strength: 0.7,
  reasons: [{ via: 'id', label: id }],
});

describe('patterns', () => {
  it('a shared ID gives its prefix, a shared URL its host', () => {
    expect(
      patternsOf({
        reasons: [
          { via: 'id', label: 'DB-12' },
          { via: 'url', label: 'https://github.com/x/y/issues/1' },
          { via: 'title', label: 'Spec' },
        ],
      }),
    ).toEqual([
      { kind: 'id', prefix: 'DB' },
      { kind: 'url', host: 'github.com' },
    ]);
  });

  it('cleans user input', () => {
    expect(cleanPattern({ kind: 'id', prefix: ' db-<n> ' })).toEqual({ kind: 'id', prefix: 'DB' });
    expect(cleanPattern({ kind: 'id', prefix: 'PROJ-12' })).toEqual({ kind: 'id', prefix: 'PROJ' });
    expect(cleanPattern({ kind: 'id', prefix: '1x' })).toBeNull();
    expect(cleanPattern({ kind: 'id', prefix: 'fe-req-<n>' })).toEqual({ kind: 'id', prefix: 'FE-REQ' });
    expect(cleanPattern({ kind: 'id', prefix: 'FE-REQ-030' })).toEqual({ kind: 'id', prefix: 'FE-REQ' });
    expect(cleanPattern({ kind: 'id', prefix: 'FE--REQ' })).toBeNull();
    expect(cleanPattern({ kind: 'url', host: 'https://Linear.app/team/issue/1' })).toEqual({
      kind: 'url',
      host: 'linear.app',
    });
    expect(cleanPattern({ kind: 'url', host: 'not a host' })).toBeNull();
  });
});

describe('decisions', () => {
  it('three accepts of DB- links propose a rule; a rule or "Not now" ends the proposal', () => {
    let data: LinkData = emptyLinks();
    data = decide(data, { source: 'a', target: 'b', accept: true }, idEdge('a', 'b', 'DB-31'), 1);
    data = decide(data, { source: 'c', target: 'd', accept: true }, idEdge('c', 'd', 'DB-32'), 2);
    expect(proposals(data)).toEqual([]);
    data = decide(data, { source: 'e', target: 'f', accept: true }, idEdge('e', 'f', 'DB-33'), 3);
    expect(proposals(data)).toEqual([{ key: 'id:DB', pattern: { kind: 'id', prefix: 'DB' }, accepts: 3 }]);

    const ruled = applyRuleOp(data, { op: 'add', pattern: { kind: 'id', prefix: 'DB' } }, 4);
    expect(proposals(ruled)).toEqual([]);
    expect(ruleFor({ via: 'id', label: 'DB-99' }, ruled.rules)).toBeDefined();
    expect(ruleFor({ via: 'id', label: 'QA-1' }, ruled.rules)).toBeUndefined();

    expect(proposals(applyRuleOp(data, { op: 'dismiss', key: 'id:DB' }, 4))).toEqual([]);
  });

  it('accepting the same pair again counts once; reject replaces accept', () => {
    let data = decide(emptyLinks(), { source: 'a', target: 'b', accept: true }, idEdge('a', 'b', 'DB-1'), 1);
    data = decide(data, { source: 'b', target: 'a', accept: true }, idEdge('a', 'b', 'DB-1'), 2);
    expect(data.accepted).toHaveLength(1);
    data = decide(data, { source: 'a', target: 'b', accept: false }, undefined, 3);
    expect(data.accepted).toHaveLength(0);
    expect(data.rejected).toHaveLength(1);
  });

  it('rules can be edited, turned off and removed; clashes and bad patterns are ignored', () => {
    let data = applyRuleOp(emptyLinks(), { op: 'add', pattern: { kind: 'id', prefix: 'DB' } }, 1);
    data = applyRuleOp(data, { op: 'add', pattern: { kind: 'id', prefix: 'QA' } }, 2);
    const [db, qa] = data.rules;
    expect(applyRuleOp(data, { op: 'add', pattern: { kind: 'id', prefix: 'db' } }, 3)).toBe(data);
    expect(
      applyRuleOp(data, { op: 'update', rule: { ...qa!, pattern: { kind: 'id', prefix: 'DB' } } }, 3),
    ).toBe(data);
    data = applyRuleOp(data, { op: 'update', rule: { ...db!, enabled: false } }, 3);
    expect(ruleFor({ via: 'id', label: 'DB-1' }, data.rules)).toBeUndefined();
    data = applyRuleOp(data, { op: 'remove', id: qa!.id }, 4);
    expect(data.rules.map((r) => r.pattern)).toEqual([{ kind: 'id', prefix: 'DB' }]);
  });
});

describe('withLink', () => {
  it('adds [[name]] as a new last line in the file’s line ending, nothing else changes', () => {
    expect(withLink('# A\r\ntext', 'Spec')).toBe('# A\r\ntext\r\n[[Spec]]\r\n');
    expect(withLink('# A\n', 'Spec')).toBe('# A\n[[Spec]]\n');
    expect(withLink('', 'Spec')).toBe('[[Spec]]\n');
  });

  it('leaves a note that already links there alone', () => {
    expect(withLink('see [[spec#Plan|the spec]]', 'Spec')).toBeNull();
    expect(withLink('see [[Spec]]', 'Spec')).toBeNull();
    expect(withLink('see [[Specs]]', 'Spec')).not.toBeNull();
  });
});

describe('T79: whole ID prefixes', () => {
  const rule = (prefix: string, enabled = true) => ({
    id: prefix,
    pattern: { kind: 'id' as const, prefix },
    enabled,
    createdAt: 0,
  });

  it('a shared compound ID gives its whole prefix', () => {
    expect(patternsOf(idEdge('a', 'b', 'FE-REQ-030'))).toEqual([{ kind: 'id', prefix: 'FE-REQ' }]);
  });

  it('a rule learned when IDs read as REQ-030 still covers FE-REQ-<n> and SRV-REQ-<n>, at segment boundaries', () => {
    expect(covers({ kind: 'id', prefix: 'REQ' }, { kind: 'id', prefix: 'FE-REQ' })).toBe(true);
    expect(covers({ kind: 'id', prefix: 'REQ' }, { kind: 'id', prefix: 'REQ' })).toBe(true);
    expect(covers({ kind: 'id', prefix: 'REQ' }, { kind: 'id', prefix: 'FREQ' })).toBe(false);
    expect(covers({ kind: 'id', prefix: 'FE-REQ' }, { kind: 'id', prefix: 'REQ' })).toBe(false);
    expect(covers({ kind: 'url', host: 'a.com' }, { kind: 'url', host: 'a.com' })).toBe(true);
    const r = { via: 'id' as const, label: 'FE-REQ-030' };
    expect(ruleFor(r, [rule('REQ')])?.id).toBe('REQ');
    expect(ruleFor(r, [rule('REQ'), rule('FE-REQ')])?.id).toBe('FE-REQ');
    expect(ruleFor(r, [rule('REQ', false)])).toBeUndefined();
    expect(ruleFor({ via: 'id', label: 'FREQ-1' }, [rule('REQ')])).toBeUndefined();
  });

  it('no proposal for a prefix an older rule already covers', () => {
    let d: LinkData = { ...emptyLinks(), rules: [rule('REQ')] };
    for (const [a, b] of [
      ['a', 'b'],
      ['a', 'c'],
      ['b', 'c'],
    ])
      d = decide(d, { source: a, target: b, accept: true }, idEdge(a, b, 'FE-REQ-1'), 0);
    expect(proposals(d)).toEqual([]);
    expect(proposals({ ...d, rules: [] })).toEqual([
      { key: 'id:FE-REQ', pattern: { kind: 'id', prefix: 'FE-REQ' }, accepts: 3 },
    ]);
  });
});
