// Rule 7 -- MGW Block Template: the on-days of a standard block build
// modality coverage across the block via one of six concrete letter-orders,
// not a lead modality layered onto every day.
//
// Corrected 2026-09-13 (John, after live-content review caught this wrong):
// the lead modality is the SOLO modality on the single-modality day and is
// ABSENT entirely on the double-modality day -- the double day is the
// *other two* modalities together, not "lead plus one more." The triple
// day still carries all three. Direction does not reverse which day is
// single/double/triple (day 1 -- lowest slot_in_block -- is always the
// single day, day 3 always the triple); it instead selects which family of
// three rotating letter-orders is in play:
//   ascending:  MGW, GWM, WMG
//   descending: MWG, WGM, GMW
// `lead_modality` is that order's first letter -- each family's three
// entries start with a different letter, so direction + lead together
// uniquely determine the full order (no extra schema column needed). John's
// stated preference: mostly ascending (1-2-3), with an occasional
// descending block (3-2-1) for variance -- no fixed cadence for how often,
// still a coach's manual call or an undefined generator heuristic.
//
// A benchmark block's own modality mix should inform the *next* block's
// order (e.g. a WG benchmark implies M is the natural next single-lead
// day, and the following block should avoid re-serving the benchmark's
// exact WG pairing) -- that's a generation-time convention, not something
// this per-slot structural check can see or enforce (it only has the one
// training_block a slot belongs to, not its neighbors).
//
// Benchmark blocks are exempt (per the seeded 'Benchmark Day Cadence'
// config's `exempt_from_modality_template` -- read from that rule's config
// rather than duplicated here, since it's that rule's flag to own).
//
// Movement/segment order within a day should follow the letter order too
// (e.g. a GWM order's double day is G-then-W in the workout) -- that's a
// content-authoring convention this structural check doesn't verify either,
// since it only looks at `target_modalities`, not movement sequencing.
const RULE_NAME = 'MGW Block Template';
const ORDERS = {
    ascending: { M: ['M', 'G', 'W'], G: ['G', 'W', 'M'], W: ['W', 'M', 'G'] },
    descending: { M: ['M', 'W', 'G'], W: ['W', 'G', 'M'], G: ['G', 'M', 'W'] },
};
function sameSet(a, b) {
    if (a.length !== b.length)
        return false;
    const setB = new Set(b);
    return a.every((m) => setB.has(m));
}
export function checkMgwBlockTemplate(_sequence, context, config) {
    const cfg = config[RULE_NAME];
    if (cfg?.active === false)
        return [];
    const block = context.training_block;
    const exemptBenchmark = config['Benchmark Day Cadence']?.exempt_from_modality_template ?? true;
    if (exemptBenchmark && block.block_type === 'benchmark')
        return [];
    const violations = [];
    if (!block.lead_modality) {
        violations.push({ rule: RULE_NAME, message: `Block ${block.block_number} has no lead_modality set, but isn't a benchmark block.` });
        return violations;
    }
    if (!block.template_direction) {
        violations.push({ rule: RULE_NAME, message: `Block ${block.block_number} has no template_direction set, but isn't a benchmark block.` });
        return violations;
    }
    const order = ORDERS[block.template_direction][block.lead_modality];
    const onDays = [...block.on_days].sort((a, b) => a.slot_in_block - b.slot_in_block);
    for (const day of onDays) {
        const expected = day.slot_in_block === 1 ? [order[0]] : day.slot_in_block === 2 ? [order[1], order[2]] : order;
        const isToday = day.date === context.calendar_slot.date;
        const label = isToday ? 'today' : day.date;
        if (!sameSet(day.target_modalities, expected)) {
            violations.push({
                rule: RULE_NAME,
                message: `Block ${block.block_number} (order ${order.join('')}) expects {${expected.join(', ')}} ` +
                    `at slot ${day.slot_in_block} (${label}), but got {${day.target_modalities.join(', ') || 'none'}}.`,
            });
            if (day.slot_in_block === 2 && day.target_modalities.includes(block.lead_modality)) {
                violations.push({
                    rule: RULE_NAME,
                    message: `Block ${block.block_number}'s lead modality "${block.lead_modality}" should be ABSENT from the double-modality day (slot 2, ${label}), not present alongside the other two.`,
                });
            }
        }
    }
    return violations;
}
