// Rule 6 -- MetCon-Tied Variance: across a training year (window_days=365),
// 100 days should carry a skill/strength piece genuinely tied to that day's
// MetCon, split 50/50 skill vs. strength and 70/30 pre- vs. post-MetCon
// placement.
//
// Design decision (flagged -- this one needed real judgment calls, not
// just a literal reading of the config, and is worth confirming with John):
// a 100-ties-per-365-days target is a *whole-year cumulative* property. No
// single day's draft can make it pass or fail on its own -- you can't know
// you hit 100/365 until the window is over, and refusing to generate a
// draft today because the running total isn't exactly on pace would be
// absurd (ties are lumpy by nature; MetCons don't arrive evenly spaced).
// So this rule doesn't do a hard pass/fail on the *count* at all. What it
// does check: whether *this draft's proposed tie* (if it declares one)
// would push an already-skewed running split further off target, using
// two guardrails that are genuinely engineering choices, not doctrine:
//   - MIN_SAMPLE: don't flag anything until there's enough history (default
//     10 prior ties) for a share to mean anything -- the first few ties of
//     a program cycle are noise, not a trend.
//   - TOLERANCE_PCT: how many percentage points off the 50/50 or 70/30
//     target is tolerated before flagging (default 15 points) -- lower
//     than that and normal week-to-week lumpiness would trip this
//     constantly; the goal is catching a real, sustained drift, not
//     enforcing exact ratios day to day.
// Both are exported as constants so they're easy to tune (or override via
// config) once there's real usage data to tell whether they're too loose
// or too tight. Neither value is stated anywhere in the schema doc.
import { daysBetween } from '../util.js';
const RULE_NAME = 'MetCon-Tied Variance';
export const DEFAULT_MIN_SAMPLE = 10;
export const DEFAULT_TOLERANCE_PCT = 15;
function shareViolation(label, countsBefore, proposedKey, minSample, tolerancePct, targets) {
    const totalBefore = Object.values(countsBefore).reduce((a, b) => a + b, 0);
    if (totalBefore < minSample)
        return null; // not enough history to judge a trend
    const countsAfter = { ...countsBefore, [proposedKey]: (countsBefore[proposedKey] ?? 0) + 1 };
    const totalAfter = totalBefore + 1;
    // Only the proposed category's share matters, and only in the
    // over-represented direction: this rule catches a draft pushing an
    // already-heavy category even heavier, not one correcting an
    // under-represented category back toward target (which is exactly what
    // should happen). An absolute-deviation check would flag both directions
    // and block the correction along with the drift -- see the test file's
    // "under-represented side" case, which is what this comparison is for.
    const targetPct = targets[proposedKey];
    if (targetPct === undefined)
        return null;
    const actualPct = ((countsAfter[proposedKey] ?? 0) / totalAfter) * 100;
    if (actualPct - targetPct > tolerancePct) {
        return {
            rule: RULE_NAME,
            message: `Adding this ${label} tie (${proposedKey}) would put the year-to-date ${label} split at ${actualPct.toFixed(1)}% ${proposedKey} ` +
                `(target ${targetPct}%, tolerance +${tolerancePct} points, based on ${totalAfter} ties so far this window).`,
        };
    }
    return null;
}
export function checkMetconTiedVariance(sequence, context, config) {
    const cfg = config[RULE_NAME];
    if (cfg?.active === false)
        return [];
    const windowDays = cfg?.window_days ?? 365;
    const typeSplit = cfg?.type_split ?? { skill: 50, strength: 50 };
    const placementSplit = cfg?.placement_split ?? { pre: 70, post: 30 };
    const minSample = cfg?.min_sample ?? DEFAULT_MIN_SAMPLE;
    const tolerancePct = cfg?.tolerance_pct ?? DEFAULT_TOLERANCE_PCT;
    const today = context.calendar_slot.date;
    const priorTiesInWindow = context.prior_ties.filter((t) => daysBetween(today, t.date) <= windowDays);
    const typeCounts = { skill: 0, strength: 0 };
    const placementCounts = { pre: 0, post: 0 };
    for (const t of priorTiesInWindow) {
        typeCounts[t.segment_type] = (typeCounts[t.segment_type] ?? 0) + 1;
        placementCounts[t.placement] = (placementCounts[t.placement] ?? 0) + 1;
    }
    // Does today's draft declare a tie? Only skill/strength segments can (metcon segments are the tie target, not the source).
    const proposedTies = sequence.segments
        .filter((s) => (s.segment_type === 'skill' || s.segment_type === 'strength') && s.ties?.length)
        .map((s) => ({ segment_type: s.segment_type, placement: s.placement }));
    const violations = [];
    for (const tie of proposedTies) {
        const typeViolation = shareViolation('type', typeCounts, tie.segment_type, minSample, tolerancePct, typeSplit);
        if (typeViolation)
            violations.push(typeViolation);
        if (tie.placement) {
            const placementViolation = shareViolation('placement', placementCounts, tie.placement, minSample, tolerancePct, placementSplit);
            if (placementViolation)
                violations.push(placementViolation);
        }
    }
    return violations;
}
