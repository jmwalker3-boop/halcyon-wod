import type { DraftSegment, DraftSequence, MovementInfo, ValidationContext } from './types.js';
/** Case-insensitive lookup by canonical name or alias -- draft text is hand/model-written, not guaranteed exact-case. */
export declare function resolveMovement(context: ValidationContext, name: string): MovementInfo | undefined;
export declare function allMovements(sequence: DraftSequence): {
    segment: DraftSegment;
    name: string;
}[];
export declare function segmentsOfType(sequence: DraftSequence, type: DraftSegment['segment_type']): DraftSegment[];
/** Days (inclusive of the given date) counting back `windowDays` calendar days -- what "trailing N-day window" means throughout the doctrine rules. */
export declare function daysBetween(a: string, b: string): number;
