// Rule 7 -- MGW Block Template: the on-days of a block build in modality
// coverage -- single -> double -> triple for standard (3 on-day) blocks,
// single -> double for short (2 on-day) blocks -- with a rotating lead
// modality, and the build occasionally reverses (descending) to reduce
// predictability.
//
// Benchmark blocks are exempt (per the seeded 'Benchmark Day Cadence'
// config's `exempt_from_modality_template` -- read from that rule's config
// rather than duplicated here, since it's that rule's flag to own).
//
// Two things this rule checks, both structural (whole-block), not just
// about today's slot -- a build can only be judged as a build by looking
// at all its on-days together:
//   1. Coverage count by position: with `template_direction` 'ascending',
//      the on-day at slot_in_block position P covers P modalities (1, then
//      2, then 3); 'descending' reverses that (3, then 2, then 1 for a
//      standard block). This *is* "single -> double -> triple" whichever
//      direction it reads in -- descending is the same build run backwards,
//      not a different shape.
//   2. Lead consistency: `lead_modality` must appear in every on-day's
//      target_modalities for the block (it's what's carried through the
//      whole build), and the block's single-modality day must be exactly
//      the lead modality on its own.
//
// Not checked (flagged, matches the schema doc's own open question): which
// order the *other* two modalities get added in after the lead, and the
// exact trigger for when a block reverses -- both are explicitly
// unconfirmed in the doctrine ("Rule 7's reversal cadence... still
// undecided"), so nothing here guesses at them. This rule only verifies
// the build's *shape* (counts + lead), not a specific rotation schedule.
const RULE_NAME = 'MGW Block Template';
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
    const onDays = [...block.on_days].sort((a, b) => a.slot_in_block - b.slot_in_block);
    const n = onDays.length;
    for (const day of onDays) {
        const expectedCount = block.template_direction === 'ascending' ? day.slot_in_block : n - day.slot_in_block + 1;
        const actualCount = day.target_modalities.length;
        const isToday = day.date === context.calendar_slot.date;
        const label = isToday ? 'today' : day.date;
        if (actualCount !== expectedCount) {
            violations.push({
                rule: RULE_NAME,
                message: `Block ${block.block_number} (${block.template_direction}) expects ${expectedCount} modalit${expectedCount === 1 ? 'y' : 'ies'} ` +
                    `at slot ${day.slot_in_block} (${label}), but ${actualCount} ${actualCount === 1 ? 'is' : 'are'} targeted (${day.target_modalities.join(', ') || 'none'}).`,
            });
        }
        if (!day.target_modalities.includes(block.lead_modality)) {
            violations.push({
                rule: RULE_NAME,
                message: `Block ${block.block_number}'s lead modality "${block.lead_modality}" is missing from slot ${day.slot_in_block}'s (${label}) target modalities (${day.target_modalities.join(', ') || 'none'}).`,
            });
        }
        if (expectedCount === 1 && day.target_modalities.length === 1 && day.target_modalities[0] !== block.lead_modality) {
            violations.push({
                rule: RULE_NAME,
                message: `Block ${block.block_number}'s single-modality slot ${day.slot_in_block} (${label}) targets "${day.target_modalities[0]}", not the block's lead modality "${block.lead_modality}".`,
            });
        }
    }
    return violations;
}
