import type { FigmaPlan, FigmaProfile } from '@/shared/api';

export type FigmaFeature = 'designToCode' | 'codeConnect';
/** Why a feature may not work for this profile; shown as a tooltip, never as a hard block. */
export type FigmaReason = 'needsDevSeat' | 'mayNeedOrg' | 'limitsUnknown';

export interface FeatureState {
  feature: FigmaFeature;
  /** null = fine as far as we can tell. */
  reason: FigmaReason | null;
}

const known = (v: string) => v && v.toLowerCase() !== 'unknown';
const devSeat = (p: FigmaPlan) => /\b(dev|full|developer)\b/i.test(p.seat);
const orgTier = (p: FigmaPlan) => /\b(org|organization|enterprise)\b/i.test(p.tier);

/**
 * Which features look available, from what `whoami` said. Limits change, so this only hints — the docs link has the
 * real numbers. Unknown seat/tier → "see docs", not "disabled".
 */
export function featureStates(profile: FigmaProfile | undefined): FeatureState[] {
  const plans = profile?.state === 'connected' ? profile.plans : [];
  const seats = plans.filter((p) => known(p.seat));
  const tiers = plans.filter((p) => known(p.tier));
  const design: FigmaReason | null = !seats.length
    ? 'limitsUnknown'
    : seats.some(devSeat)
      ? null
      : 'needsDevSeat';
  const connect: FigmaReason | null = !tiers.length
    ? 'limitsUnknown'
    : tiers.some(orgTier)
      ? null
      : 'mayNeedOrg';
  return [
    { feature: 'designToCode', reason: design },
    { feature: 'codeConnect', reason: connect },
  ];
}

/** "Org name (tier, seat)" of the best plan (Dev/Full seat first), or null when nothing is known. */
export function planLabel(profile: FigmaProfile, unknown: string): string | null {
  const best = profile.plans.find(devSeat) ?? profile.plans[0];
  if (!best) return null;
  const name = known(best.name) ? best.name : unknown;
  const detail = [best.tier, best.seat].filter(known).join(', ');
  return detail ? `${name} (${detail})` : name;
}
