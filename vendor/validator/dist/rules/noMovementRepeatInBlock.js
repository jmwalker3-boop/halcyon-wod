// Rule 8 -- No Movement Repeat Within a 3-1 Block (new, 2026-09-04): the
// same *specific* movement (not just its pattern -- this is stricter than
// Rule 2's 2-of-3 pattern check) cannot be programmed twice within a single
// training_block, across that block's on-days and its skill/recovery day.
// A variation of the movement (front squat, goblet squat, etc. in place of
// back squat) is fine -- the restriction is on the literal exercise, not
// the pattern it belongs to.
//
// Confirmed with John (2026-09-04) to apply uniformly to every block in
// the Rule 5 macro-cycle, including the benchmark-led one -- the Benchmark
// day counts as one of that block's three on-days, so it's in scope like
// any other on-day, not a special case. No block_type exemption, unlike
// Rule 7 (which does exempt benchmark blocks from the modality template).
//
// Scope: this rule deliberately reads `context.block_movements` -- every
// OTHER day already committed in the *current* training_block, any
// day_type -- rather than the rolling, program-wide `trailing_days` window
// Rule 2 uses. Rule 2's window is a day-count (trailing 3 days, wherever
// they fall); this rule's window is a block boundary (whatever days that
// block happens to span). Those are genuinely different shapes of "recent,"
// so this isn't sharing trailing_days's data even though the code pattern
// looks similar to twoOfThree.ts.
//
// The one exception -- the same movement appearing twice *within today's
// own draft* as the deliberate Rule 6 pairing (a strength piece, e.g. 5x5
// Back Squat, leading directly into that same day's MetCon using a lighter
// version of the same movement) -- isn't special-cased in this code: it
// falls out naturally, because this rule only ever compares today's
// movements against *other days'* already-committed movements in the
// block, never against themselves. One day's tied session was never a
// cross-day repeat to begin with.
//
// John's own read on where the real risk sits, worth keeping in mind when
// reading a violation: the day immediately following a single-modality day
// never carries a lifting piece anyway (so that day is a non-issue by
// construction) -- the actual risk is a movement reappearing on the
// block's third (triple, WMG/WGM) day, or on a skill/recovery day within
// the block.
import { allMovements, resolveMovement } from '../util.js';
const RULE_NAME = 'No Movement Repeat Within a 3-1 Block';
export function checkNoMovementRepeatInBlock(sequence, context, config) {
    const cfg = config[RULE_NAME];
    if (cfg?.active === false)
        return [];
    const today = context.calendar_slot.date;
    // canonical movement name -> the other date(s) in this block that already used it.
    const priorUseInBlock = new Map();
    for (const day of context.block_movements) {
        if (day.date === today)
            continue; // defensive -- today shouldn't have a committed workout yet at draft time
        for (const rawName of day.movement_names) {
            const info = resolveMovement(context, rawName);
            const canonical = info?.canonical_name ?? rawName;
            const dates = priorUseInBlock.get(canonical) ?? [];
            dates.push(day.date);
            priorUseInBlock.set(canonical, dates);
        }
    }
    const violations = [];
    const alreadyFlagged = new Set(); // report each repeated movement once, even if it appears in multiple segments today
    for (const { name } of allMovements(sequence)) {
        const info = resolveMovement(context, name);
        const canonical = info?.canonical_name ?? name;
        if (alreadyFlagged.has(canonical))
            continue;
        const priorDates = priorUseInBlock.get(canonical);
        if (priorDates && priorDates.length > 0) {
            alreadyFlagged.add(canonical);
            violations.push({
                rule: RULE_NAME,
                message: `"${canonical}" already appears earlier in this block, on ${priorDates.join(', ')} -- ` +
                    `the same movement can't repeat anywhere else in a 3-1 block (a variation like a front squat ` +
                    `or goblet squat instead of a back squat would be fine).`,
            });
        }
    }
    return violations;
}
