// Rule 2 -- 2-of-3 Rule: no movement pattern repeats more than twice in a
// trailing N-day window (N=3, max_repeats=2 by default), applied uniformly
// across Training/Skill/Recovery days -- no day-type exemption.
//
// "Repeats" is day-level presence, not per-movement occurrence count: a
// pattern used by two different movements on the same day still only
// counts as one day's use of that pattern. This matches the worked example
// in generation_demo.py -- squat pattern used via a Monday back squat and a
// Wednesday wall-ball metcon (two separate days) is exactly the "used
// twice" case that bans it on the third day.
//
// window_days counts *today plus* the trailing days, so with the default
// window_days=3 / max_repeats=2, a pattern already present on both of the
// prior two days in the window can't be used again today (that would be a
// 3rd day out of 3 sharing the pattern); present on 0 or 1 prior days is
// fine.
import { allMovements, daysBetween, resolveMovement } from '../util.js';
const RULE_NAME = '2-of-3 Rule';
export function checkTwoOfThree(sequence, context, config) {
    const cfg = config[RULE_NAME];
    if (cfg?.active === false)
        return [];
    const appliesTo = cfg?.applies_to_day_types ?? ['Training', 'Skill', 'Recovery'];
    if (!appliesTo.includes(context.calendar_slot.day_type))
        return [];
    const windowDays = cfg?.window_days ?? 3;
    const maxRepeats = cfg?.max_repeats ?? 2;
    const today = context.calendar_slot.date;
    // Days strictly before today, within the trailing window (window_days - 1 prior days).
    const priorDaysInWindow = context.trailing_days.filter((d) => {
        const delta = daysBetween(today, d.date);
        return delta > 0 && delta <= windowDays - 1;
    });
    // Every pattern touched by today's draft.
    const todaysPatterns = new Set();
    for (const { name } of allMovements(sequence)) {
        const info = resolveMovement(context, name);
        if (info)
            info.patterns.forEach((p) => todaysPatterns.add(p));
    }
    const violations = [];
    for (const pattern of todaysPatterns) {
        const priorDaysWithPattern = priorDaysInWindow.filter((d) => d.patterns.includes(pattern));
        const totalDaysWithPattern = priorDaysWithPattern.length + 1; // +1 for today
        if (totalDaysWithPattern > maxRepeats) {
            violations.push({
                rule: RULE_NAME,
                message: `Pattern "${pattern}" would appear on ${totalDaysWithPattern} of the trailing ${windowDays} days ` +
                    `(${priorDaysWithPattern.map((d) => d.date).join(', ')} and today) -- max allowed is ${maxRepeats}.`,
            });
        }
    }
    return violations;
}
