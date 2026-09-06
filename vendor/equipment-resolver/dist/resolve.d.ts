import type { MovementToResolve, OwnedEquipment, ResolvedMovement, RxContext } from './types.js';
/**
 * Resolves one movement from the coach's base workout to one athlete's actual Rx.
 *
 * Two independent scaling passes, in order (see the 20260904120000 migration's
 * header for the reasoning): first skill level (gymnastics-only, via
 * rx.skillSubstitutes -- movement_scales), then equipment (via
 * rx.equipmentSubstitutes -- movement_equipment_substitutes). Either pass is a
 * no-op if its data isn't supplied (both are optional), so existing 2-argument
 * call sites resolve exactly as before -- only 'ok' | 'rounded' | 'needs_substitution'
 * | 'needs_load_data' can come back without an RxContext.
 *
 * Deliberately does NOT chase a substitute-of-a-substitute, and does NOT
 * invent a swap when neither data source has one on file -- a gap with no
 * resolvable answer comes back as `needs_substitution` for a human to make
 * that call, same philosophy as the original version of this function.
 */
export declare function resolveMovementForAthlete(movement: MovementToResolve, owned: OwnedEquipment, rx?: RxContext): ResolvedMovement;
export declare function resolveWorkoutForAthlete(movements: MovementToResolve[], owned: OwnedEquipment, rx?: RxContext): ResolvedMovement[];
