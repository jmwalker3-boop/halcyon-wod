// Precomputes which patterns the 2-of-3 rule would already reject today,
// *before* a draft exists -- so a prompt can tell the drafting model "don't
// use these patterns" up front instead of letting it guess and burn a
// generation attempt on a violation the context already rules out. This is
// the same trailing-window reasoning rules/twoOfThree.ts checks a draft
// against, but deliberately not literally shared code with it -- that file
// is already tested and working, and refactoring it to call this just to
// dedupe a few lines risked changing its violation-message text for no
// real benefit. Instead, this has its own unit test asserting its banned
// set matches what twoOfThree.ts would actually reject for the same
// context, so the two are verified equivalent without one depending on
// the other.
import { daysBetween } from './util.js';
export function computeBannedPatterns(context, config) {
    const cfg = config['2-of-3 Rule'];
    if (cfg?.active === false)
        return [];
    const appliesTo = cfg?.applies_to_day_types ?? ['Training', 'Skill', 'Recovery'];
    if (!appliesTo.includes(context.calendar_slot.day_type))
        return [];
    const windowDays = cfg?.window_days ?? 3;
    const maxRepeats = cfg?.max_repeats ?? 2;
    const today = context.calendar_slot.date;
    const priorDaysInWindow = context.trailing_days.filter((d) => {
        const delta = daysBetween(today, d.date);
        return delta > 0 && delta <= windowDays - 1;
    });
    const counts = new Map();
    for (const day of priorDaysInWindow) {
        for (const pattern of day.patterns)
            counts.set(pattern, (counts.get(pattern) ?? 0) + 1);
    }
    // A pattern already at (or past) the cap from prior days alone is banned --
    // using it today, even once, would push a fourth... rather, an (maxRepeats+1)th
    // day over the limit.
    return [...counts.entries()].filter(([, count]) => count >= maxRepeats).map(([pattern]) => pattern);
}
