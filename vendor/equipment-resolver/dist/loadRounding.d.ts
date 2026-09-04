import type { OwnedLoad, WeightUnit } from './types.js';
export declare function needsLoadRounding(equipmentTag: string): boolean;
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
export declare function roundToOwnedLoad(prescribedLoad: number, unit: WeightUnit, ownedLoads: OwnedLoad[]): number | null;
