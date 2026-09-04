import { normalizeEquipmentTag } from './equipmentAliases.js';
// Matches the "discrete weights owned per tag" comment in
// 20260903160000_profile_equipment.sql -- equipment classes where the athlete
// might own some but not all weights (a 15/25lb dumbbell pair, not a full
// rack). Everything else (bar, pull-up bar, rings, box, ghd, rower) is
// presence-only: either you have it or you don't, there's nothing to round.
const DISCRETE_LOAD_EQUIPMENT = new Set([
    'dumbbell',
    'kettlebell',
    'plate',
    'band',
    'sandbag',
    'med ball',
    'wall ball',
]);
export function needsLoadRounding(equipmentTag) {
    return DISCRETE_LOAD_EQUIPMENT.has(normalizeEquipmentTag(equipmentTag));
}
/**
 * Rounds a prescribed load down to the nearest weight the athlete actually owns.
 * Rounding DOWN (never up) when a lighter owned option exists is the safer
 * default -- it undershoots the coach's number rather than adding weight nobody
 * asked for. If every owned weight is heavier than prescribed, there's nothing
 * lighter to fall back to, so the smallest owned weight is returned as the best
 * available -- an athlete in that spot has more weight than the session calls
 * for, not less, and that's a real state, not a bug.
 *
 * Returns null if the athlete has no owned loads recorded for this equipment
 * class at all -- deliberately distinct from "rounded to the smallest owned
 * weight," since that's a data gap (see ResolvedMovementStatus.needs_load_data),
 * not a resolvable rounding case.
 */
export function roundToOwnedLoad(prescribedLoad, unit, ownedLoads) {
    const ownedValues = ownedLoads.filter((l) => l.unit === unit).map((l) => l.value);
    if (ownedValues.length === 0)
        return null;
    const atOrBelow = ownedValues.filter((v) => v <= prescribedLoad);
    if (atOrBelow.length > 0)
        return Math.max(...atOrBelow);
    return Math.min(...ownedValues);
}
