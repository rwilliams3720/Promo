// Pure calculation functions for the annual raise-eligibility tracker.
// Called from api/agent-goals.js (attachRaiseStatus) — no DB access here,
// mirrors the pattern already used by api/_lib/commission-calc.js.

const POLICY_KEYS = ['wl', 'ul', 'term', 'health', 'auto', 'fire', 'policies'];
const COMBINATION_MODES = ['individual', 'blended', 'separate'];
const REWARD_MODES = ['proportional', 'threshold'];
const STRETCH_MODES = ['auto', 'custom'];
const AGENCY_METRICS = ['count', 'premium'];

// Call-metric goal keys — fixed, system-defined metrics, so their direction
// (higher-is-better vs lower-is-better) is a hardcoded fact, not a per-goal
// choice, unlike bonus_activity_types.analysis_direction (which IS
// per-account-configurable, for arbitrary custom activities). handle_rate is
// higher-better (the existing actual/target ratio shape already works);
// voicemail_count/missed_calls are lower-better (fewer is the goal).
const CALL_METRIC_KEYS = ['handle_rate', 'voicemail_count', 'missed_calls'];
const LOWER_BETTER_KEYS = new Set(['voicemail_count', 'missed_calls']);
// Caps a lower-better metric's ratio at 200% so a near-zero actual (e.g. 0
// missed calls against a target of 5) can't produce an outlier — e.g. 5/0 —
// that would dominate the plain average this function takes across every
// active ratio on the goal.
const LOWER_BETTER_RATIO_CAP = 2;

function round2(n) { return Math.round(n * 100) / 100; }

// Fractional months elapsed within an annual period, based on calendar days —
// not whole-month counting — so a mid-month check still gets a proportionally
// accurate pace instead of jumping in whole-month steps. Floored at a small
// nonzero value so annualizedPct never divides by (near) zero on day 1.
export function computeMonthsElapsed(periodStart, periodEnd, todayStr) {
  const start = new Date(periodStart + 'T00:00:00Z');
  const end   = new Date(periodEnd   + 'T00:00:00Z');
  const today = new Date((todayStr || periodEnd) + 'T00:00:00Z');
  const clamped = today < start ? start : (today > end ? end : today);
  const totalDays   = (end - start) / 86400000 + 1;
  const elapsedDays = (clamped - start) / 86400000 + 1;
  return Math.max((elapsedDays / totalDays) * 12, 1 / 30);
}

// Individual progress % — mean of (actual/target*100) across every metric key
// already present on the goal (products, policies, premium, activity_*,
// combined_groups), reusing computeActuals()'s output rather than
// re-deriving actuals. Not capped at 100 — the reward math needs values above
// 100 to flow through for the stretch zone.
export function computeIndividualProgressPct(goal) {
  const goals   = goal.goals   || {};
  const actuals = goal.actuals || {};
  const ratios = [];

  for (const key of POLICY_KEYS) {
    const target = Number(goals[key]);
    if (goals[key] !== undefined && target > 0) ratios.push((Number(actuals[key]) || 0) / target);
  }
  const premiumTarget = Number(goals.premium);
  if (goals.premium !== undefined && premiumTarget > 0) {
    ratios.push((Number(actuals.premium) || 0) / premiumTarget);
  }
  for (const key of Object.keys(goals)) {
    if (!key.startsWith('activity_')) continue;
    const target = Number(goals[key]);
    if (target > 0) ratios.push((Number(actuals[key]) || 0) / target);
  }
  if (Array.isArray(goals.combined_groups)) {
    for (const grp of goals.combined_groups) {
      const target = Number(grp.target);
      if (target > 0) ratios.push((Number(actuals['combined_' + grp.id]) || 0) / target);
    }
  }
  for (const key of CALL_METRIC_KEYS) {
    const target = Number(goals[key]);
    if (goals[key] === undefined || !(target > 0)) continue;
    const actual = Number(actuals[key]) || 0;
    const ratio = LOWER_BETTER_KEYS.has(key)
      ? (actual > 0 ? Math.min(target / actual, LOWER_BETTER_RATIO_CAP) : LOWER_BETTER_RATIO_CAP)
      : actual / target; // handle_rate — same shape as every higher-better ratio above
    ratios.push(ratio);
  }

  if (!ratios.length) return 0;
  return round2((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100);
}

// Agency progress % — actual/goal*100 for whichever of goal_count_annual /
// goal_premium_annual agencyMetric selects. actualCount/actualPremium are the
// caller's own year-scoped, sale_weight-summed aggregation (not computed here
// — this file has no DB access).
export function computeAgencyProgressPct(location, actualCount, actualPremium, agencyMetric) {
  if (!location) return 0;
  if (agencyMetric === 'premium') {
    const goal = Number(location.goal_premium_annual) || 0;
    return goal > 0 ? round2((Number(actualPremium) || 0) / goal * 100) : 0;
  }
  const goal = Number(location.goal_count_annual) || 0;
  return goal > 0 ? round2((Number(actualCount) || 0) / goal * 100) : 0;
}

// individual -> individualPct; blended -> weighted average; separate -> null
// (no single combined number, per spec — each side stands alone).
export function computeCombinedProgressPct(individualPct, agencyPct, mode, blendIndividualWeight) {
  if (mode === 'separate') return null;
  if (mode === 'blended') {
    const w = Math.max(0, Math.min(100, Number(blendIndividualWeight) ?? 70)) / 100;
    return round2(individualPct * w + (agencyPct || 0) * (1 - w));
  }
  return individualPct;
}

// The gate always keys off the agent's OWN individual %, regardless of
// combination mode — the point of the gate is to stop a blended/agency
// number from papering over personal underperformance.
export function gatePassed(individualPct, gateEnabled, gateFloorPct) {
  if (!gateEnabled) return true;
  return individualPct >= (Number(gateFloorPct) || 0);
}

// Proportional reward: earns `targetPct` in full at 100% of goal (linear from
// 0%), then keeps earning at the SAME per-point rate into a stretch zone for
// exceeding goal, capped at `maxPct`. The stretch zone's width (where it caps
// out) is either derived automatically from the target/max ratio, or an
// explicit custom breakpoint — a custom breakpoint genuinely changes the
// stretch-zone rate (spreads the same bonus over more or less overachievement),
// not just where the bar visually maxes out.
export function computeProportionalReward(progressPct, targetPct, maxPct, stretchMode, customBreakpointPct) {
  const target = Math.max(Number(targetPct) || 0, 0);
  const max    = Math.max(Number(maxPct) || 0, target);
  const rate   = target / 100;
  const progress = Math.max(Number(progressPct) || 0, 0);

  if (progress <= 100 || rate <= 0) {
    return { earnedPct: round2(Math.min(rate * progress, max)), stretchBreakpointPct: null };
  }

  const autoBreakpoint = 100 + (max - target) / rate;
  const useCustom = stretchMode === 'custom' && Number(customBreakpointPct) > 100;
  const breakpoint = useCustom ? Number(customBreakpointPct) : autoBreakpoint;

  const stretchRange    = Math.max(breakpoint - 100, 0.0001);
  const stretchProgress = Math.min(progress - 100, stretchRange);
  const earned = target + (max - target) * (stretchProgress / stretchRange);

  return { earnedPct: round2(Math.min(earned, max)), stretchBreakpointPct: round2(breakpoint) };
}

// Threshold reward: a step function — pays the HIGHEST tier whose pct is
// <= progressPct, not additive/cumulative like bonus_activity_types' milestone
// + repeat tiers (same validated-array shape precedent, different evaluation
// semantics — this is "% of goal breakpoints," not "raw occurrence count
// milestones").
export function computeThresholdReward(progressPct, tiers) {
  const sorted = [...(tiers || [])].sort((a, b) => Number(a.pct) - Number(b.pct));
  let earnedPct = 0, tierIndex = -1;
  sorted.forEach((t, i) => {
    if (progressPct >= Number(t.pct)) { earnedPct = Number(t.raise) || 0; tierIndex = i; }
  });
  return { earnedPct: round2(earnedPct), tierIndex };
}

// Same validation shape/cap as api/bonus-activities.js's sanitizeThresholdTiers
// (max 20 tiers), different fields since this is keyed by % of goal, not a
// raw activity count.
export function sanitizeRaiseThresholdTiers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(t => ({ pct: parseFloat(t?.pct), raise: parseFloat(t?.raise) }))
    .filter(t => !isNaN(t.pct) && t.pct >= 0 && t.pct <= 500 && !isNaN(t.raise) && t.raise >= 0)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 20);
}

// Validates/clamps a full raise_config object before persisting. Does NOT
// validate agency_location_id against the DB — that's a DB-backed check left
// to the route handler, keeping this file DB-free.
export function sanitizeRaiseConfig(raw) {
  const cfg = raw || {};
  const combination_mode = COMBINATION_MODES.includes(cfg.combination_mode) ? cfg.combination_mode : 'individual';
  const reward_mode      = REWARD_MODES.includes(cfg.reward_mode) ? cfg.reward_mode : 'proportional';
  const agency_metric    = AGENCY_METRICS.includes(cfg.agency_metric) ? cfg.agency_metric : 'count';

  const prop = cfg.proportional || {};
  const target_pct  = Math.max(0, parseFloat(prop.target_pct) || 0);
  const maxPctRaw   = parseFloat(prop.max_pct);
  const max_pct     = Math.max(target_pct, isNaN(maxPctRaw) ? target_pct : maxPctRaw);
  const stretch_mode = STRETCH_MODES.includes(prop.stretch_mode) ? prop.stretch_mode : 'auto';
  const breakpointRaw = parseFloat(prop.stretch_breakpoint_pct);
  const stretch_breakpoint_pct = (stretch_mode === 'custom' && breakpointRaw > 100) ? breakpointRaw : null;

  return {
    combination_mode,
    agency_location_id: combination_mode !== 'individual' ? (cfg.agency_location_id || null) : null,
    agency_metric,
    blend_individual_weight: Math.max(0, Math.min(100, parseFloat(cfg.blend_individual_weight) ?? 70)),
    reward_mode,
    proportional: { target_pct, max_pct, stretch_mode, stretch_breakpoint_pct },
    threshold_tiers: sanitizeRaiseThresholdTiers(cfg.threshold_tiers),
    gate_enabled: !!cfg.gate_enabled,
    gate_floor_pct: Math.max(0, Math.min(100, parseFloat(cfg.gate_floor_pct) || 0)),
  };
}

export function annualizedPct(progressPct, monthsElapsed) {
  const months = Math.max(Number(monthsElapsed) || 0, 0.001);
  return round2((Number(progressPct) || 0) / months * 12);
}

// YTD (raw magnitude) thresholds — deliberately different cutoffs than the
// annualized scheme below, since "how much have you done" and "are you on
// pace" are different questions with different honest answers.
export function colorForYtd(pct) {
  if (pct >= 80) return 'green';
  if (pct >= 50) return 'yellow';
  return 'red';
}

// Annualized (projected pace) thresholds.
export function colorForAnnualized(pct) {
  if (pct >= 100) return 'green';
  if (pct >= 80) return 'yellow';
  return 'red';
}
