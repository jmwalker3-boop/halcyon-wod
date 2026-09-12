import type { DraftSegment, DraftSequence, MovementInfo, ValidationContext } from './types.js';

/** Case-insensitive lookup by canonical name or alias -- draft text is hand/model-written, not guaranteed exact-case. */
export function resolveMovement(context: ValidationContext, name: string): MovementInfo | undefined {
  return context.movements_by_name.get(name.trim().toLowerCase());
}

export function allMovements(sequence: DraftSequence): { segment: DraftSegment; name: string }[] {
  return sequence.segments.flatMap((segment) => segment.movements.map((m) => ({ segment, name: m.name })));
}

export function segmentsOfType(sequence: DraftSequence, type: DraftSegment['segment_type']): DraftSegment[] {
  return sequence.segments.filter((s) => s.segment_type === type).sort((a, b) => a.order_index - b.order_index);
}

/** Days (inclusive of the given date) counting back `windowDays` calendar days -- what "trailing N-day window" means throughout the doctrine rules. */
export function daysBetween(a: string, b: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / msPerDay);
}
