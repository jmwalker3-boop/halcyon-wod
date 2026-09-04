// Mirrors the `config` jsonb seeded onto each `rules` row in
// 20260903120008_seed_rules.sql, as plain typed defaults. The engine always
// prefers whatever's actually in the `rules` table (a coach/admin can tune
// these without a code deploy) -- this file is the fallback when a rule row
// is missing or its config is incomplete, and it's what the unit tests run
// against so they don't depend on a live DB.
export const DEFAULT_RULE_CONFIG = {
    'Compound First': {
        active: true,
        compound_patterns: ['squat', 'hinge', 'push-vertical', 'push-horizontal'],
    },
    '2-of-3 Rule': {
        active: true,
        window_days: 3,
        max_repeats: 2,
        applies_to_day_types: ['Training', 'Skill', 'Recovery'],
    },
    'Strength Based on Recent Rep Maxes': {
        active: true,
        record_type: '1RM',
        recency_window_days: 90,
    },
    'Exceptions Need a Logical Reason': {
        active: true,
        requires_override_reason_on_failed_validation: true,
    },
    'Benchmark Day Cadence': {
        active: true,
        // Corrected 2026-09-04: a 3-block macro-cycle, every block shaped
        // 3-on-days + 1-off-day. The first block's on-days are Benchmark then
        // 2 ordinary on-days ("Benchmark, 2-1" is John's label for that mix,
        // not a literal 2-on-day block) -- the Benchmark itself is folded into
        // that block's "3", so benchmark blocks need exactly 3 on-days too, the
        // same as the other two. 3 blocks x 4 days = 12 days/cycle, so the next
        // Benchmark lands on day 13 with zero drift. 'short' (2-on-day) blocks
        // no longer appear anywhere in this rotation -- that block_type still
        // exists in the schema (block_type_enum) but isn't produced by this
        // cadence as corrected.
        block_pattern: ['benchmark', 'standard', 'standard'],
        on_days_by_block_type: { benchmark: 3, standard: 3 },
        exempt_from_modality_template: true,
    },
    'No Movement Repeat Within a 3-1 Block': {
        active: true,
    },
    'MetCon-Tied Variance': {
        active: true,
        window_days: 365,
        total_target: 100,
        type_split: { skill: 50, strength: 50 },
        placement_split: { pre: 70, post: 30 },
    },
    'MGW Block Template': {
        active: true,
        lead_rotation: ['M', 'G', 'W'],
        // Reversal trigger is still an open question in the schema doc (Rule 7)
        // -- see rules/mgwBlockTemplate.ts for how the validator handles that
        // ambiguity today rather than guessing at an unconfirmed trigger.
    },
};
export function mergeRuleConfig(fromDb) {
    const merged = {};
    for (const name of Object.keys(DEFAULT_RULE_CONFIG)) {
        merged[name] = { ...DEFAULT_RULE_CONFIG[name], ...(fromDb?.[name] ?? {}) };
    }
    return merged;
}
