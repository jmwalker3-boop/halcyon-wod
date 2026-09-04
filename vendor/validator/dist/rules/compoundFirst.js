// Rule 1 -- Compound First: the strength segment's first movement must be a
// compound lift (squat/hinge/push-vertical/push-horizontal pattern).
//
// Scope decision (flagged, not silently assumed): this rule only fires when
// the draft actually has a strength segment. Whether every Training day is
// *required* to have one is a program-design question upstream of the
// validator (the schema doc doesn't say every day needs a strength piece --
// Skill and Recovery days plausibly don't), so "no strength segment" is
// treated as "rule doesn't apply today," not a violation. If a strength
// segment exists, its first movement (by array order, which is the
// authored sequence -- see types.ts) must be compound; a strength segment
// with zero movements is itself the violation (nothing to be compound-first).
import { resolveMovement, segmentsOfType } from '../util.js';
const RULE_NAME = 'Compound First';
export function checkCompoundFirst(sequence, context, config) {
    const cfg = config[RULE_NAME];
    if (cfg?.active === false)
        return [];
    const compoundPatterns = new Set(cfg?.compound_patterns ?? []);
    const violations = [];
    for (const strengthSegment of segmentsOfType(sequence, 'strength')) {
        const first = strengthSegment.movements[0];
        if (!first) {
            violations.push({
                rule: RULE_NAME,
                message: `Strength segment (order_index ${strengthSegment.order_index}) has no movements -- can't be compound-first.`,
            });
            continue;
        }
        const info = resolveMovement(context, first.name);
        if (!info) {
            violations.push({
                rule: RULE_NAME,
                message: `Strength segment's first movement "${first.name}" isn't a recognized movement (checked against the taxonomy by canonical name and alias).`,
            });
            continue;
        }
        const isCompound = info.patterns.some((p) => compoundPatterns.has(p));
        if (!isCompound) {
            violations.push({
                rule: RULE_NAME,
                message: `Strength segment's first movement "${first.name}" (patterns: ${info.patterns.join(', ') || 'none'}) isn't a compound lift -- needs one of: ${[...compoundPatterns].join(', ')}.`,
            });
        }
    }
    return violations;
}
