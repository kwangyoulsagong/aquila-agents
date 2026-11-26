import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '@/shared/api';
import { louvain, titleWords, topicGroups } from './clusters';

const edge = (source: string, target: string): GraphEdge => ({
  id: `${source}→${target}`,
  source,
  target,
  kind: 'explicit',
  strength: 1,
  reasons: [],
});

describe('louvain', () => {
  it('finds two triangles joined by a bridge', () => {
    const c = louvain(6, [
      [0, 1, 1],
      [1, 2, 1],
      [2, 0, 1],
      [3, 4, 1],
      [4, 5, 1],
      [5, 3, 1],
      [2, 3, 1],
    ]);
    expect(c[0]).toBe(c[1]);
    expect(c[1]).toBe(c[2]);
    expect(c[3]).toBe(c[4]);
    expect(c[0]).not.toBe(c[3]);
  });

  it('keeps isolated nodes apart and handles no edges', () => {
    expect([...louvain(3, [])]).toEqual([0, 1, 2]);
  });
});

describe('titleWords', () => {
  it('lowercased words, numbers / short IDs / dates dropped', () => {
    expect(titleWords('F012 Coupon discount — API v2 (2026-11-20)')).toEqual(['coupon', 'discount', 'api']);
    expect(titleWords('결제 재시도 · 결제')).toEqual(['결제', '재시도']);
  });
});

describe('topicGroups', () => {
  // Two linked sets whose titles talk about different things, plus two loose notes.
  const titled = (id: string, label: string): GraphNode => ({ id, kind: 'note', label });
  const pay = ['결제 재시도', '결제 쿠폰 적용', '쿠폰 결제 오류', '결제 영수증', '쿠폰 만료'].map((l, i) =>
    titled(`p${i}`, l),
  );
  const auth = ['login token refresh', 'login form', 'token expiry', 'login rate limit'].map((l, i) =>
    titled(`a${i}`, l),
  );
  const loose = [titled('x1', 'misc idea'), titled('x2', 'reading list')];
  const ring = (ns: GraphNode[]) => ns.flatMap((n, i) => ns.slice(i + 1).map((m) => edge(n.id, m.id)));
  const view = {
    nodes: [...pay, ...auth, ...loose],
    edges: [...ring(pay), ...ring(auth), edge('p0', 'a0')],
  };

  it('splits by links and names each group by its own words', () => {
    const t = topicGroups(
      view,
      view.nodes.map((n) => n.id),
    )!;
    expect(t.map((g) => [g.words, g.ids.length])).toEqual([
      [['결제', '쿠폰'], 5],
      [['login', 'token'], 4],
      [[], 2],
    ]);
    expect(t.at(-1)!.key).toBe('topic:~');
  });

  it('the same members give the same keys', () => {
    const ids = view.nodes.map((n) => n.id);
    expect(topicGroups(view, ids)!.map((g) => g.key)).toEqual(
      topicGroups(view, [...ids].reverse())!.map((g) => g.key),
    );
  });

  it('notes outside the set they all point at group them (two checklists of one spec)', () => {
    const spec = titled('spec', 'spec');
    const lists = ['결제 체크', '결제 확인', '결제 점검', 'login 체크', 'login 확인', 'login 점검'].map(
      (l, i) => titled(`c${i}`, l),
    );
    const v = {
      nodes: [spec, titled('spec2', 'spec2'), ...lists],
      edges: [0, 1, 2].map((i) => edge(`c${i}`, 'spec')).concat([3, 4, 5].map((i) => edge(`c${i}`, 'spec2'))),
    };
    const t = topicGroups(
      v,
      lists.map((n) => n.id),
    )!;
    expect(t.map((g) => [g.words, g.ids.length])).toEqual([
      [['login'], 3],
      [['결제'], 3],
    ]);
  });

  it('no links: titles that share a word still group; nothing shared → null', () => {
    const t = topicGroups(
      { nodes: view.nodes, edges: [] },
      view.nodes.map((n) => n.id),
    )!;
    const first = t.map((g) => g.words[0]);
    expect(first).toContain('결제');
    expect(first).toContain('login');
    // Every note is somewhere, once.
    expect(t.flatMap((g) => g.ids).sort()).toEqual(view.nodes.map((n) => n.id).sort());
    const odd = ['alpha', 'beta', 'gamma', 'delta'].map((l, i) => titled(`o${i}`, l));
    expect(
      topicGroups(
        { nodes: odd, edges: [] },
        odd.map((n) => n.id),
      ),
    ).toBeNull();
  });
});
