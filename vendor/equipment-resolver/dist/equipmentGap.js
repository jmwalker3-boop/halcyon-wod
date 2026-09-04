import { normalizeEquipmentTag } from './equipmentAliases.js';
// "bodyweight" and "none" both mean "nothing to own" -- "none" is Run's tag
// (seed_movements.sql), added here because the original exemption list only
// covered "bodyweight" and would otherwise have flagged every Run as missing
// equipment called "none" for every athlete, always. Found 2026-09-04 while
// extending this module for skill/equipment substitution -- a real, live bug
// in the already-shipped equipment check, not something new.
const ALWAYS_SATISFIED = new Set(['bodyweight', 'none']);
// A handful of movements genuinely need MORE THAN ONE equipment class AT THE
// SAME TIME (a band assisting a dip on rings needs the rings AND the band
// together) -- everything else in the taxonomy that lists more than one
// non-bodyweight tag means "any one of these works" (Bench Press: barbell OR
// dumbbell; Thruster; Push Press; Romanian Deadlift; Farmer's Carry; Goblet
// Squat; Walking Lunge; etc.). The original version of this function treated
// every multi-tag movement as AND, which meant an athlete who owns only
// dumbbells (no barbell) was incorrectly flagged as missing gear for Bench
// Press, Thruster, and everything else with a listed dumbbell alternative --
// found 2026-09-04 while building the equipment-substitution feature on top
// of this. Fixed here rather than worked around, since it affects the
// equipment-check UI already shipped to /dashboard.
const REQUIRES_ALL_LISTED_EQUIPMENT = new Set(['Band-Assisted Dip', 'Banded Pull-up']);
export function checkEquipmentGap(movementName, requiredEquipment, ownedTags) {
    const normalizedOwned = new Set([...ownedTags].map(normalizeEquipmentTag));
    const owns = (tag) => normalizedOwned.has(normalizeEquipmentTag(tag));
    const relevant = requiredEquipment.filter((tag) => !ALWAYS_SATISFIED.has(tag));
    let missingEquipment;
    if (REQUIRES_ALL_LISTED_EQUIPMENT.has(movementName)) {
        missingEquipment = relevant.filter((tag) => !owns(tag));
    }
    else if (relevant.length === 0 || relevant.some(owns)) {
        // Either nothing real is required, or the athlete owns at least one of
        // the listed alternatives -- either way, no gap.
        missingEquipment = [];
    }
    else {
        // Owns none of the listed alternatives -- report the full set so the
        // athlete/coach can see what any one of them would unlock.
        missingEquipment = relevant;
    }
    return {
        movementName,
        requiredEquipment,
        missingEquipment,
        ok: missingEquipment.length === 0,
    };
}
