// Rule 3 -- Strength Based on Recent Rep Maxes: loading reads the athlete's
// most recent 1RM (within a recency window), not a stored percentage table.
//
// Scope decision (flagged): this rule only fires on movements whose
// `prescribed_load.basis` is explicitly 'recent_1rm_pct' -- that's the
// draft claiming its load came from a recent max, and this rule checks the
// claim. A 'fixed' or 'bodyweight' basis is a different, legitimate kind of
// prescription (a coach-set technique-work weight, or no load at all) and
// isn't what this rule is guarding against -- it's aimed at the failure
// mode of silently pulling from a stale or nonexistent rep-max record while
// still labeling the prescription as max-based, not at banning fixed loads
// outright. If BBM's intent is actually "every strength-segment load must
// be 1RM-based, full stop," that's a one-line change here (fail on any
// non-'recent_1rm_pct' basis too) -- worth confirming with John before the
// generator relies on this either way.
import { daysBetween, segmentsOfType } from '../util.js';
const RULE_NAME = 'Strength Based on Recent Rep Maxes';
export function checkStrengthRecentRepMax(sequence, context, config) {
    const cfg = config[RULE_NAME];
    if (cfg?.active === false)
        return [];
    const recencyWindowDays = cfg?.recency_window_days ?? 90;
    const violations = [];
    for (const strengthSegment of segmentsOfType(sequence, 'strength')) {
        for (const movement of strengthSegment.movements) {
            if (movement.prescribed_load?.basis !== 'recent_1rm_pct')
                continue;
            const records = context.rep_maxes
                .filter((r) => r.movement_name.toLowerCase() === movement.name.trim().toLowerCase())
                .sort((a, b) => (a.achieved_at < b.achieved_at ? 1 : -1)); // most recent first
            const mostRecent = records[0];
            if (!mostRecent) {
                violations.push({
                    rule: RULE_NAME,
                    message: `"${movement.name}" is prescribed as a % of a recent 1RM, but this athlete has no rep-max record for it on file.`,
                });
                continue;
            }
            const age = daysBetween(context.as_of_date, mostRecent.achieved_at);
            if (age > recencyWindowDays) {
                violations.push({
                    rule: RULE_NAME,
                    message: `"${movement.name}"'s most recent rep-max record is ${age} days old (from ${mostRecent.achieved_at}) -- stale beyond the ${recencyWindowDays}-day recency window.`,
                });
            }
        }
    }
    return violations;
}
