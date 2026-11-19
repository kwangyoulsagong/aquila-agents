import { describe, expect, it } from 'vitest';
import type { FigmaProfile } from '@/shared/api';
import { featureStates, planLabel } from './profile';

const profile = (plans: FigmaProfile['plans'], state: FigmaProfile['state'] = 'connected'): FigmaProfile => ({
  state,
  checkedAt: 1,
  plans,
});

describe('featureStates', () => {
  it('is fine with a Dev seat on an Organization plan', () => {
    expect(featureStates(profile([{ name: 'Acme', tier: 'organization', seat: 'Dev' }]))).toEqual([
      { feature: 'designToCode', reason: null },
      { feature: 'codeConnect', reason: null },
    ]);
  });
  it('flags a View seat and a Professional plan', () => {
    expect(featureStates(profile([{ name: 'Me', tier: 'professional', seat: 'view' }]))).toEqual([
      { feature: 'designToCode', reason: 'needsDevSeat' },
      { feature: 'codeConnect', reason: 'mayNeedOrg' },
    ]);
  });
  it('any plan with a Full seat counts', () => {
    const states = featureStates(
      profile([
        { name: 'A', tier: 'starter', seat: 'view' },
        { name: 'B', tier: 'enterprise', seat: 'full' },
      ]),
    );
    expect(states.every((s) => s.reason === null)).toBe(true);
  });
  it('unknown fields, no profile or a failed check → see docs', () => {
    for (const p of [
      profile([{ name: 'unknown', tier: 'unknown', seat: 'unknown' }]),
      undefined,
      profile([], 'needsAuth'),
    ])
      expect(featureStates(p).map((s) => s.reason)).toEqual(['limitsUnknown', 'limitsUnknown']);
  });
});

describe('planLabel', () => {
  it('prefers the Dev/Full seat plan and skips unknown parts', () => {
    expect(
      planLabel(
        profile([
          { name: 'Home', tier: 'starter', seat: 'unknown' },
          { name: 'Acme', tier: 'organization', seat: 'dev' },
        ]),
        '?',
      ),
    ).toBe('Acme (organization, dev)');
    expect(planLabel(profile([{ name: 'unknown', tier: 'unknown', seat: 'unknown' }]), '?')).toBe('?');
    expect(planLabel(profile([]), '?')).toBeNull();
  });
});
