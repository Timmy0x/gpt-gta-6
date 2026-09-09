import type { CharacterDamageKind } from './combat/injuries';

export const BODY_REGIONS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;
export type BodyRegion = typeof BODY_REGIONS[number];
export interface RegionInjury { severity: number; healDelay: number }
/** Independent of the legacy casualty marker: standing survivors can have persistent injuries. */
export interface BodyInjuryState {
  version: 1;
  regions: Record<BodyRegion, RegionInjury>;
  systemic: RegionInjury;
  fallRemaining: number;
  riseRemaining: number;
  critical: boolean;
}
export type InjuryMode = 'healthy' | 'limping' | 'hunched' | 'down' | 'crawling' | 'recovering';
export interface BodyInjuryEffects {
  mode: InjuryMode;
  speedScale: number;
  maxSpeed: number;
  canSprint: boolean;
  canJump: boolean;
  canStand: boolean;
  canAim: boolean;
  handlingScale: number;
  systemic: number;
  leftLeg: number; rightLeg: number; leftArm: number; rightArm: number; torso: number; head: number;
  limpSide: -1 | 0 | 1;
  /** 0 is standing, 1 is fully grounded; recovery reverses this continuously. */
  groundBlend: number;
}
export const BODY_INJURY_RULES = {
  fallSeconds: 1.2,
  riseSeconds: 3.0,
  healSecondsPerSeverity: 300,
  minorHealDelay: 35,
  seriousHealDelay: 90,
  severeHealDelay: 180,
} as const;
const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
export function createBodyInjuries(): BodyInjuryState {
  return { version: 1, regions: Object.fromEntries(BODY_REGIONS.map(region => [region, { severity: 0, healDelay: 0 }])) as BodyInjuryState['regions'], systemic: { severity: 0, healDelay: 0 }, fallRemaining: 0, riseRemaining: 0, critical: false };
}
function criticalAt(state: BodyInjuryState, recovering = false): boolean {
  const s = state.regions;
  return state.systemic.severity >= (recovering ? .50 : .80) || s.head.severity >= (recovering ? .38 : .60) || s.torso.severity >= (recovering ? .55 : .72)
    || Math.min(s.leftLeg.severity, s.rightLeg.severity) >= (recovering ? .42 : .60)
    || Math.max(s.leftLeg.severity, s.rightLeg.severity) >= (recovering ? .68 : .86);
}
/** Damage values and durations are authored game balance, not medical thresholds. */
export function applyBodyImpact(previous: BodyInjuryState | null | undefined, impact: { region: BodyRegion; kind: CharacterDamageKind; damage: number; health: number }): BodyInjuryState {
  const state = previous ? cloneBodyInjuries(previous) : createBodyInjuries();
  if (!BODY_REGIONS.includes(impact.region) || !Number.isFinite(impact.damage) || impact.damage <= 0) return state;
  const region = state.regions[impact.region];
  const sensitivity = impact.region === 'head' ? 1.25 : impact.region === 'torso' ? .85 : 1;
  region.severity = clamp(region.severity + impact.damage / 60 * sensitivity);
  region.healDelay = Math.max(region.healDelay, region.severity >= .75 ? BODY_INJURY_RULES.severeHealDelay
    : impact.kind === 'projectile' || region.severity >= .4 ? BODY_INJURY_RULES.seriousHealDelay : BODY_INJURY_RULES.minorHealDelay);
  // Distributed wounds can disable the whole body without inventing a torso wound.
  if (Number.isFinite(impact.health) && impact.health <= 20) {
    state.systemic.severity = Math.max(state.systemic.severity, clamp(1 - impact.health / 100));
    state.systemic.healDelay = Math.max(state.systemic.healDelay, BODY_INJURY_RULES.severeHealDelay);
  }
  const becameCritical = criticalAt(state);
  const heavyKnockdown = impact.kind === 'impact' && impact.damage >= 40 || impact.kind === 'explosion' && impact.damage >= 25;
  if ((becameCritical && !state.critical) || heavyKnockdown) {
    state.fallRemaining = BODY_INJURY_RULES.fallSeconds;
    state.riseRemaining = 0;
  }
  state.critical ||= becameCritical;
  return state;
}
/** Only simulation time heals injuries; pausing, switching actors and save/load do not. */
export function advanceBodyInjuries(state: BodyInjuryState | null | undefined, dt: number): void {
  if (!state || !Number.isFinite(dt) || dt <= 0) return;
  const wasCritical = state.critical, oldFall = state.fallRemaining;
  const below = (region: BodyRegion | 'systemic', threshold: number) => {
    const injury = region === 'systemic' ? state.systemic : state.regions[region];
    return injury.severity < threshold ? 0 : injury.healDelay + (injury.severity - threshold) * BODY_INJURY_RULES.healSecondsPerSeverity;
  };
  const criticalReleaseAt = Math.max(below('systemic', .50), below('head', .38), below('torso', .55),
    Math.min(below('leftLeg', .42), below('rightLeg', .42)), Math.max(below('leftLeg', .68), below('rightLeg', .68)));
  state.fallRemaining = Math.max(0, oldFall - dt);
  for (const injury of [...Object.values(state.regions), state.systemic]) {
    const healingTime = Math.max(0, dt - injury.healDelay);
    injury.healDelay = Math.max(0, injury.healDelay - dt);
    injury.severity = Math.max(0, injury.severity - healingTime / BODY_INJURY_RULES.healSecondsPerSeverity);
  }
  if (state.critical && !criticalAt(state, true)) state.critical = false;
  if (wasCritical && !state.critical || oldFall > 0 && state.fallRemaining === 0 && !state.critical) {
    const transitionAt = Math.max(oldFall, wasCritical ? criticalReleaseAt : 0);
    state.riseRemaining = Math.max(0, BODY_INJURY_RULES.riseSeconds - Math.max(0, dt - transitionAt));
  } else state.riseRemaining = Math.max(0, state.riseRemaining - dt);
}
export function bodyInjuryEffects(state: BodyInjuryState | null | undefined): BodyInjuryEffects {
  const values = Object.fromEntries(BODY_REGIONS.map(region => [region, state?.regions[region].severity ?? 0])) as Record<BodyRegion, number>;
  const { leftLeg, rightLeg, leftArm, rightArm, torso, head } = values;
  const systemic = state?.systemic.severity ?? 0;
  const leg = Math.max(leftLeg, rightLeg), arm = Math.max(leftArm, rightArm), burden = Math.max(leg, torso, head, systemic);
  const mode: InjuryMode = (state?.fallRemaining ?? 0) > 0 ? 'down' : state?.critical ? 'crawling'
    : (state?.riseRemaining ?? 0) > 0 ? 'recovering' : leg >= .1 ? 'limping' : torso >= .1 || head >= .1 || arm >= .1 || systemic >= .1 ? 'hunched' : 'healthy';
  const down = mode === 'down' || mode === 'crawling' || mode === 'recovering';
  const speedScale = down ? mode === 'crawling' ? .12 * (1 - arm * .35) : 0 : clamp(1 - leg * .68 - torso * .32 - head * .22 - systemic * .35, .15, 1);
  return { ...values, systemic, mode, speedScale, maxSpeed: down ? mode === 'crawling' ? .65 * (1 - arm * .45) : 0 : 7.1 * speedScale,
    canSprint: !down && burden < .16, canJump: !down && leg < .12 && torso < .28 && systemic < .2, canStand: !down,
    canAim: !down && arm < .85 && head < .5 && systemic < .65, handlingScale: clamp(1 - arm * .55 - head * .3 - torso * .15 - systemic * .15, .15, 1),
    limpSide: leg < .1 || Math.abs(leftLeg - rightLeg) < .03 ? 0 : leftLeg > rightLeg ? -1 : 1,
    groundBlend: mode === 'down' ? clamp(1 - state!.fallRemaining / BODY_INJURY_RULES.fallSeconds)
      : mode === 'crawling' ? 1 : mode === 'recovering' ? clamp(state!.riseRemaining / BODY_INJURY_RULES.riseSeconds) : 0 };
}
export function cloneBodyInjuries(state: BodyInjuryState): BodyInjuryState {
  return { version: 1, regions: Object.fromEntries(BODY_REGIONS.map(region => [region, { ...state.regions[region] }])) as BodyInjuryState['regions'], systemic: { ...state.systemic }, fallRemaining: state.fallRemaining, riseRemaining: state.riseRemaining, critical: state.critical };
}
export function validateBodyInjuries(value: unknown): value is BodyInjuryState {
  if (!value || typeof value !== 'object') return false;
  const state = value as BodyInjuryState;
  if (state.version !== 1 || typeof state.critical !== 'boolean' || !state.regions || typeof state.regions !== 'object') return false;
  if (![state.fallRemaining, state.riseRemaining].every(Number.isFinite) || state.fallRemaining < 0 || state.fallRemaining > BODY_INJURY_RULES.fallSeconds || state.riseRemaining < 0 || state.riseRemaining > BODY_INJURY_RULES.riseSeconds) return false;
  return [...BODY_REGIONS.map(region => state.regions[region]), state.systemic].every(r => { return !!r && [r.severity, r.healDelay].every(Number.isFinite) && r.severity >= 0 && r.severity <= 1 && r.healDelay >= 0 && r.healDelay <= BODY_INJURY_RULES.severeHealDelay; });
}

export function hasBodyInjuries(state: BodyInjuryState | null | undefined): boolean {
  return !!state && (state.fallRemaining > 0 || state.riseRemaining > 0 || state.critical || state.systemic.severity > 0 || BODY_REGIONS.some(region => state.regions[region].severity > 0));
}

/** Apply health scaling separately; regional trauma still receives the original local damage. */
export function regionalHealthDamage(amount: number, region: BodyRegion, kind: CharacterDamageKind): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const multiplier = kind === 'projectile' ? region === 'head' ? 2 : region === 'torso' ? 1 : .65
    : kind === 'melee' && region === 'head' ? 1.35 : 1;
  return amount * multiplier;
}

/** A healed survivor can crawl out from under an obstacle before attempting to stand. */
export function blockedCrawlEffects(effects: BodyInjuryEffects): BodyInjuryEffects {
  const arm = Math.max(effects.leftArm, effects.rightArm);
  return { ...effects, mode: 'crawling', groundBlend: 1, speedScale: .12 * (1 - arm * .35), maxSpeed: .65 * (1 - arm * .45),
    canStand: false, canSprint: false, canJump: false, canAim: false };
}
