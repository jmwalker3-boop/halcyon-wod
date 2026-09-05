import type { MovementToResolve, OwnedEquipment, ResolvedMovement, RxContext } from './types.js';
export declare function resolveMovementForAthlete(movement: MovementToResolve, owned: OwnedEquipment, rx?: RxContext): ResolvedMovement;
export declare function resolveWorkoutForAthlete(movements: MovementToResolve[], owned: OwnedEquipment, rx?: RxContext): ResolvedMovement[];
