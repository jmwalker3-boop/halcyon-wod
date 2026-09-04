// Rule 5 -- Benchmark Day Cadence: a fixed repeating 3-block macro-cycle,
// every block shaped 3-on-days + 1-off-day (4 days). The first block's 3
// on-days are Benchmark, then 2 ordinary on-days -- "Benchmark, 2-1" is
// John's label for that mix (2 of the 3 on-days are regular programming),
// not a literal 2-on-day block; the Benchmark itself is folded into that
// block's "3", so it needs exactly 3 on-days like the other two blocks.
// 3 blocks x 4 days = 12 days/macro-cycle, so the next Benchmark lands on
// day 13 with zero drift.
//
// Corrected 2026-09-04: this used to be modeled as a 4-block rotation
// (Benchmark(1) + 2-1(2) + 3-1(3) + 3-1(3) treated as four separate
// blocks, i.e. a real 2-on-day "short" block in the middle). John clarified
// that's wrong -- "Benchmark, 2-1" is one block, not two. The fix lives
// entirely in ruleConfig.ts's defaults (block_pattern and
// on_days_by_block_type) -- this file's logic was already
// config-parameterized, so no code change was needed here beyond this
// comment.
//
// Scope decision (flagged): this is a scaffolding rule, not really a
// per-draft content rule -- it's checking that the *calendar/block
// structure* this draft is being generated into is itself correctly
// cadenced, not anything about the draft's movements. `ValidationContext`
// only carries the one `training_block` the current slot belongs to (see
// types.ts), not its two siblings in the macro-cycle, so the full 12-day
// "sums to exactly 12, next Benchmark on day 13" invariant across all 3
// blocks isn't checked here -- that's a program_cycle-level invariant,
// better checked once when a cycle is created/regenerated than on every
// single draft. What *is* checked per draft: this block's type matches
// where it sits in the benchmark/standard/standard rotation, this block
// has the right number of on-days for its type (3, for both types now),
// and today's slot is actually one of them (catches a slot being asked to
// generate a workout on what should be the block's off-day).
//
// Per the seeded config, benchmark blocks are exempt from Rule 7's modality
// template (see rules/mgwBlockTemplate.ts) -- that's read from this same
// config object, not duplicated here. Rule 8 (no movement repeat within
// the block) applies to every block including this one -- no exemption --
// see rules/noMovementRepeatInBlock.ts.
const RULE_NAME = 'Benchmark Day Cadence';
export function checkBenchmarkDayCadence(_sequence, context, config) {
    const cfg = config[RULE_NAME];
    if (cfg?.active === false)
        return [];
    const blockPattern = cfg?.block_pattern ?? ['benchmark', 'standard', 'standard'];
    const onDaysByType = cfg?.on_days_by_block_type ?? {
        benchmark: 3,
        standard: 3,
    };
    const block = context.training_block;
    const violations = [];
    const positionInCycle = (block.block_number - 1) % blockPattern.length;
    const expectedType = blockPattern[positionInCycle];
    if (block.block_type !== expectedType) {
        violations.push({
            rule: RULE_NAME,
            message: `Block ${block.block_number} is type "${block.block_type}", but position ${positionInCycle + 1} of the ${blockPattern.length}-block macro-cycle should be "${expectedType}".`,
        });
    }
    const expectedOnDays = onDaysByType[block.block_type];
    if (expectedOnDays !== undefined && block.on_days.length !== expectedOnDays) {
        violations.push({
            rule: RULE_NAME,
            message: `Block ${block.block_number} (${block.block_type}) has ${block.on_days.length} on-day(s) scheduled, expected exactly ${expectedOnDays}.`,
        });
    }
    if (!block.on_days.some((d) => d.date === context.calendar_slot.date)) {
        violations.push({
            rule: RULE_NAME,
            message: `${context.calendar_slot.date} isn't one of block ${block.block_number}'s scheduled on-days (${block.on_days.map((d) => d.date).join(', ') || 'none'}) -- a workout shouldn't be generated for it.`,
        });
    }
    return violations;
}
